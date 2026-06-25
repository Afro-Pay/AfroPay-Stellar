import { WalletService } from "./wallet.service";

// Minimal unit tests without DB — test encryption helpers via reflection
describe("WalletService encryption", () => {
  let service: WalletService;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64); // 32-byte hex
    service = new WalletService(null as any);
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
        findUnique: jest.fn().mockResolvedValue(wallet),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new WalletService(prisma);
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
