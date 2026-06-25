import * as crypto from "crypto";
import { PrismaClient } from "../apps/api/node_modules/@prisma/client";

const prisma = new PrismaClient();

function getMasterKey() {
  const configuredKey = process.env.ENCRYPTION_KEY;
  if (!configuredKey) {
    throw new Error("ENCRYPTION_KEY is required");
  }

  return Buffer.from(configuredKey, "hex");
}

function deriveUserKey(userId: string) {
  return crypto.hkdfSync(
    "sha256",
    getMasterKey(),
    Buffer.alloc(16),
    Buffer.from(userId, "utf8"),
    32,
  );
}

function encryptWalletSecret(text: string, userId: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveUserKey(userId),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decryptLegacyWalletSecret(data: string) {
  const parts = data.split(":");
  if (parts.length !== 2) {
    return null;
  }

  const [ivHex, encrypted] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    getMasterKey(),
    Buffer.from(ivHex, "hex"),
  );
  return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
}

async function migrateEncryption() {
  const wallets = await prisma.wallet.findMany({
    select: { id: true, userId: true, encryptedSecret: true },
  });

  for (const wallet of wallets) {
    const legacyPlaintext = decryptLegacyWalletSecret(wallet.encryptedSecret);
    if (!legacyPlaintext) {
      continue;
    }

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        encryptedSecret: encryptWalletSecret(legacyPlaintext, wallet.userId),
      },
    });
  }

  console.log(`Migrated ${wallets.length} wallet record(s) to AES-256-GCM.`);
}

migrateEncryption()
  .catch((error) => {
    console.error("Encryption migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
