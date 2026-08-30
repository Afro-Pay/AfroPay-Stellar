import { WalletService } from "./wallet.service";
import * as trustlineUtils from "../anchor/trustline.utils";
import { Keypair } from "stellar-sdk";

// Minimal unit tests without DB — test encryption helpers via reflection
describe("WalletService encryption", () => {
  let service: WalletService;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64); // 32-byte hex
    service = new WalletService(null as any, { log: jest.fn() } as any, { info: jest.fn(), error: jest.fn() } as any);
  });

  it("encrypts and decrypts a secret key", () => {
    const secret = "SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD";
    const encrypted = (service as any).encrypt(secret, "user-1");
    const decrypted = (service as any).decrypt(encrypted, "user-1");
    expect(decrypted).toBe(secret);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const secret = "SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD";
    const enc1 = (service as any).encrypt(secret, "user-1");
    const enc2 = (service as any).encrypt(secret, "user-1");
    expect(enc1).not.toBe(enc2);
  });

  it("throws AuthTagMismatch when ciphertext is tampered with", () => {
    const secret = "SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD";
    const encrypted = (service as any).encrypt(secret, "user-1");
    const tampered = encrypted.replace(
      /:([0-9a-f]+)$/,
      (_match, authTag) => `:${authTag.slice(0, -2)}aa`,
    );

    expect(() => (service as any).decrypt(tampered, "user-1")).toThrow(
      "AuthTagMismatch",
    );
  });
});

describe("WalletService delegated signing", () => {
  it("forwards unsigned XDR to the external signer boundary", async () => {
    const signer = {
      signTransaction: jest.fn().mockResolvedValue({
        signedTransactionXdr: "signed-xdr",
        signerPublicKey: "GPUBLIC",
        requestId: "request-1",
      }),
    };
    const service = new WalletService(null as any, signer as any);

    await expect(service.signTransaction("user-1", "unsigned-xdr"))
      .resolves.toEqual(expect.objectContaining({ signedTransactionXdr: "signed-xdr" }));
    expect(signer.signTransaction).toHaveBeenCalledWith("user-1", "unsigned-xdr");
  });
});

describe("WalletService reconciliation", () => {
  let service: WalletService;
  let prisma: any;

  const wallet = {
    id: "wallet-1",
    userId: "user-1",
    publicKey: "GBXACCOUNT",
    encryptedSecret: "encrypted",
  };

  beforeEach(() => {
    prisma = {
      wallet: {
        findFirst: jest.fn().mockResolvedValue(wallet),
        findUnique: jest.fn().mockResolvedValue(wallet),
        findFirst: jest.fn().mockResolvedValue(wallet),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new WalletService(prisma, { log: jest.fn() } as any, { info: jest.fn(), error: jest.fn() } as any);
  });

  it("returns an in-sync report when expected assets have matching trustlines", async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        assetCode: "USDC",
        assetIssuer: "GISSUER",
        status: "SUCCESS",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    jest.spyOn(service as any, "loadAccount").mockResolvedValue({
      sequence: "123",
      last_modified_ledger: 100,
      last_modified_time: "2026-01-02T00:00:00Z",
      balances: [
        { asset_type: "native", balance: "10.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GISSUER",
          balance: "25.0000000",
          limit: "1000.0000000",
        },
      ],
    });

    const report = await service.reconcileWallet("user-1");

    expect(report.status).toBe("in_sync");
    expect(report.summary).toMatchObject({
      discrepancyCount: 0,
      criticalCount: 0,
      missingTrustlineCount: 0,
    });
    expect(report.onChain.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: "XLM", trustline: false }),
        expect.objectContaining({
          asset: "USDC",
          assetIssuer: "GISSUER",
          trustline: true,
        }),
      ]),
    );
  });

  it("flags missing trustlines for assets referenced by application transactions", async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        assetCode: "EURC",
        assetIssuer: "GEURCISSUER",
        status: "PENDING",
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ]);
    jest.spyOn(service as any, "loadAccount").mockResolvedValue({
      sequence: "124",
      last_modified_ledger: 101,
      last_modified_time: "2026-01-02T00:00:00Z",
      balances: [{ asset_type: "native", balance: "10.0000000" }],
    });

    const report = await service.reconcileWallet("user-1");

    expect(report.status).toBe("drift_detected");
    expect(report.summary.missingTrustlineCount).toBe(1);
    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "MISSING_TRUSTLINE",
          severity: "warning",
          asset: "EURC",
          assetIssuer: "GEURCISSUER",
        }),
        expect.objectContaining({
          type: "STALE_LEDGER_STATE",
          severity: "info",
        }),
      ]),
    );
  });

  it("returns a critical report when the stored wallet is not found on-chain", async () => {
    jest
      .spyOn(service as any, "loadAccount")
      .mockRejectedValue({ response: { status: 404 } });

    const report = await service.reconcileWallet("user-1");

    expect(report.status).toBe("drift_detected");
    expect(report.onChain.accountFound).toBe(false);
    expect(report.summary.criticalCount).toBe(1);
    expect(report.discrepancies).toEqual([
      expect.objectContaining({
        type: "ON_CHAIN_ACCOUNT_NOT_FOUND",
        severity: "critical",
      }),
    ]);
  });
});

describe("WalletService createWallet", () => {
  let service: WalletService;
  let prisma: any;
  let auditService: any;
  let logger: any;

  beforeEach(() => {
    prisma = { wallet: { create: jest.fn() } };
    auditService = { log: jest.fn() };
    logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    service = new WalletService(prisma, auditService, logger);
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("funds new wallets via Friendbot on testnet", async () => {
    prisma.wallet.create.mockResolvedValue({ id: "w1", userId: "user-1", publicKey: "GPUBKEY" });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    const wallet = await service.createWallet("user-1", "GPUBKEY");

    expect(wallet.publicKey).toBe("GPUBKEY");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("friendbot.stellar.org?addr=GPUBKEY"),
    );
  });

  it("does not fail wallet creation when Friendbot funding fails", async () => {
    prisma.wallet.create.mockResolvedValue({ id: "w1", userId: "user-1", publicKey: "GPUBKEY" });
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    await expect(service.createWallet("user-1", "GPUBKEY")).resolves.toMatchObject({
      publicKey: "GPUBKEY",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "wallet_funding_failed" }),
    );
  });
});

describe("WalletService addTrustline", () => {
  let service: any;
  let prisma: any;
  let auditService: any;
  let logger: any;
  const publicKey = "GBXACCOUNT";

  beforeEach(() => {
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: "w1", userId: "user-1", publicKey }),
      },
    };
    auditService = { log: jest.fn() };
    logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    service = new WalletService(prisma, auditService, logger);
    jest.spyOn(service, "getKeypair").mockResolvedValue(Keypair.random());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds a trustline and returns the created result", async () => {
    jest.spyOn(trustlineUtils, "ensureTrustline").mockResolvedValue({
      created: true,
      txHash: "tx123",
      status: { status: "exists", balance: "0", limit: "1000", asset: { code: "USDC", issuer: "GISSUER" } },
    });

    const result = await service.addTrustline("user-1", "USDC", "GISSUER", "1000");

    expect(result).toMatchObject({ created: true, txHash: "tx123", assetCode: "USDC" });
    expect(auditService.log).toHaveBeenCalledWith(
      "user-1",
      "WALLET_TRUSTLINE_ADD",
      expect.objectContaining({ assetCode: "USDC", assetIssuer: "GISSUER" }),
    );
  });

  it("is a no-op when the trustline already exists", async () => {
    jest.spyOn(trustlineUtils, "ensureTrustline").mockResolvedValue({
      created: false,
      status: { status: "exists", balance: "50", limit: "1000", asset: { code: "USDC", issuer: "GISSUER" } },
    });

    const result = await service.addTrustline("user-1", "USDC", "GISSUER");

    expect(result.created).toBe(false);
  });

  it("wraps trustline errors as BadRequestException", async () => {
    jest.spyOn(trustlineUtils, "ensureTrustline").mockRejectedValue({
      code: "INSUFFICIENT_RESERVE",
      message: "Insufficient XLM reserve to create trustline (op_low_reserve)",
      asset: { code: "USDC", issuer: "GISSUER" },
    });

    await expect(service.addTrustline("user-1", "USDC", "GISSUER")).rejects.toThrow(
      "Insufficient XLM reserve",
    );
  });

  it("throws NotFoundException when the user has no wallet", async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);

    await expect(service.addTrustline("user-1", "USDC", "GISSUER")).rejects.toThrow(
      "Wallet not found",
    );
  });
});

describe("WalletService getBalances", () => {
  let service: any;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: "w1", userId: "user-1", publicKey: "GBXACCOUNT" }),
      },
    };
    service = new WalletService(
      prisma,
      { log: jest.fn() } as any,
      { info: jest.fn(), error: jest.fn() } as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns mapped balances for a funded account", async () => {
    jest.spyOn(service, "loadAccount").mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "10.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GISSUER",
          balance: "5.0000000",
          limit: "1000",
        },
      ],
    });

    const balances = await service.getBalances("user-1");

    expect(balances).toEqual([
      expect.objectContaining({ asset: "XLM", trustline: false }),
      expect.objectContaining({ asset: "USDC", assetIssuer: "GISSUER", trustline: true }),
    ]);
  });

  it("returns an empty array for an unfunded/not-found account", async () => {
    jest.spyOn(service, "loadAccount").mockRejectedValue({ response: { status: 404 } });

    const balances = await service.getBalances("user-1");

    expect(balances).toEqual([]);
  });

  it("throws NotFoundException when the user has no wallet", async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);

    await expect(service.getBalances("user-1")).rejects.toThrow("Wallet not found");
  });
});

describe("WalletService Horizon failover", () => {
  it("loads accounts through the RPC client when available", async () => {
    const rpcClient = {
      withHorizonServer: jest.fn(async (operation) =>
        operation({
          loadAccount: jest.fn().mockResolvedValue({ sequence: "200", balances: [] }),
        }),
      ),
    };
    const service = new WalletService(null as any, undefined, rpcClient as any);

    await expect((service as any).loadAccount("GACCOUNT")).resolves.toMatchObject({
      sequence: "200",
    });
    expect(rpcClient.withHorizonServer).toHaveBeenCalledTimes(1);
  });
});

describe("WalletService multi-wallet CRUD", () => {
  let service: WalletService;
  let prisma: any;

  const userId = "user-1";

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    prisma = {
      wallet: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new WalletService(prisma);
  });

  describe("createWallet", () => {
    it("creates a wallet with isDefault=true for first wallet", async () => {
      prisma.wallet.findMany.mockResolvedValue([]);
      prisma.wallet.create.mockResolvedValue({
        id: "wallet-1",
        userId,
        publicKey: "GPUBLIC1",
        alias: "Primary",
        isDefault: true,
        createdAt: new Date(),
      });

      const result = await service.createWallet(userId, "GPUBLIC1", "Primary");

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({ where: { userId } });
      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: {
          userId,
          publicKey: "GPUBLIC1",
          alias: "Primary",
          isDefault: true,
        },
      });
      expect(result.isDefault).toBe(true);
    });

    it("creates a wallet with isDefault=false for subsequent wallets", async () => {
      prisma.wallet.findMany.mockResolvedValue([{ id: "wallet-1" }]);
      prisma.wallet.create.mockResolvedValue({
        id: "wallet-2",
        userId,
        publicKey: "GPUBLIC2",
        alias: "Savings",
        isDefault: false,
        createdAt: new Date(),
      });

      const result = await service.createWallet(userId, "GPUBLIC2", "Savings");

      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: {
          userId,
          publicKey: "GPUBLIC2",
          alias: "Savings",
          isDefault: false,
        },
      });
      expect(result.isDefault).toBe(false);
    });

    it("rejects wallets exceeding the 5-wallet limit", async () => {
      prisma.wallet.findMany.mockResolvedValue(Array(5).fill({ id: "wallet" }));

      await expect(
        service.createWallet(userId, "GPUBLIC", "Over Limit")
      ).rejects.toThrow("Wallet limit (5) reached");
    });

    it("rejects aliases exceeding 32 characters", async () => {
      prisma.wallet.findMany.mockResolvedValue([]);

      const longAlias = "a".repeat(33);
      await expect(
        service.createWallet(userId, "GPUBLIC", longAlias)
      ).rejects.toThrow("32 characters or less");
    });
  });

  describe("getWallets", () => {
    it("returns all wallets for a user", async () => {
      const wallets = [
        { id: "w1", userId, alias: "Primary", isDefault: true },
        { id: "w2", userId, alias: "Savings", isDefault: false },
      ];
      prisma.wallet.findMany.mockResolvedValue(wallets);

      const result = await service.getWallets(userId);

      expect(result).toEqual(wallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe("getDefaultWallet", () => {
    it("returns the default wallet", async () => {
      const wallet = { id: "w1", userId, alias: "Primary", isDefault: true };
      prisma.wallet.findFirst.mockResolvedValue(wallet);

      const result = await service.getDefaultWallet(userId);

      expect(result).toEqual(wallet);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: { userId, isDefault: true },
      });
    });

    it("throws NotFoundException if no default wallet", async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.getDefaultWallet(userId)
      ).rejects.toThrow("No default wallet found");
    });
  });

  describe("setDefaultWallet", () => {
    it("sets a wallet as default and clears other defaults", async () => {
      const walletId = "w2";
      prisma.wallet.findUnique.mockResolvedValue({
        id: walletId,
        userId,
        isDefault: false,
      });
      prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
      prisma.wallet.update.mockResolvedValue({
        id: walletId,
        userId,
        isDefault: true,
      });

      await service.setDefaultWallet(walletId, userId);

      expect(prisma.wallet.updateMany).toHaveBeenCalledWith(
        {
          where: { userId, isDefault: true },
          data: { isDefault: false },
        }
      );
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: walletId },
        data: { isDefault: true },
      });
    });
  });

  describe("updateWalletAlias", () => {
    it("updates a wallet alias", async () => {
      const walletId = "w1";
      prisma.wallet.findUnique.mockResolvedValue({
        id: walletId,
        userId,
      });
      prisma.wallet.update.mockResolvedValue({
        id: walletId,
        userId,
        alias: "New Alias",
      });

      await service.updateWalletAlias(walletId, userId, "New Alias");

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: walletId },
        data: { alias: "New Alias" },
      });
    });

    it("rejects aliases exceeding 32 characters", async () => {
      const walletId = "w1";
      prisma.wallet.findUnique.mockResolvedValue({ id: walletId, userId });

      await expect(
        service.updateWalletAlias(walletId, userId, "a".repeat(33))
      ).rejects.toThrow("32 characters or less");
    });
  });

  describe("deleteWallet", () => {
    it("prevents deletion of the last wallet", async () => {
      const walletId = "w1";
      prisma.wallet.findUnique.mockResolvedValue({
        id: walletId,
        userId,
        isDefault: false,
      });
      prisma.wallet.count.mockResolvedValue(1);

      await expect(
        service.deleteWallet(walletId, userId)
      ).rejects.toThrow("Cannot delete the last wallet");
    });

    it("deletes a wallet and sets another as default if needed", async () => {
      const walletId = "w1";
      const otherWalletId = "w2";
      prisma.wallet.findUnique.mockResolvedValue({
        id: walletId,
        userId,
        isDefault: true,
      });
      prisma.wallet.count.mockResolvedValue(2);
      prisma.wallet.findFirst.mockResolvedValue({
        id: otherWalletId,
        userId,
      });
      prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
      prisma.wallet.update.mockResolvedValue({
        id: otherWalletId,
        userId,
        isDefault: true,
      });
      prisma.wallet.delete.mockResolvedValue({ id: walletId });

      await service.deleteWallet(walletId, userId);

      expect(prisma.wallet.updateMany).toHaveBeenCalled();
      expect(prisma.wallet.delete).toHaveBeenCalledWith({
        where: { id: walletId },
      });
    });
  });
});
