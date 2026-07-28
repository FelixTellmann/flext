import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@server/env";

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: number;
};

const CURRENT_KEY_VERSION = 1;
const IV_BYTES = 12;

function encryption_key(): Buffer {
  return Buffer.from(serverEnv().MAIL_ENCRYPTION_KEY, "hex");
}

export function encryptCredential(plaintext: string): EncryptedCredential {
  // A fresh IV per record is mandatory under GCM. Reusing one does not raise an
  // error — it silently destroys both confidentiality and unforgeability.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryption_key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    key_version: CURRENT_KEY_VERSION,
  };
}

export function decryptCredential(record: EncryptedCredential): string {
  if (record.key_version !== CURRENT_KEY_VERSION) {
    throw new Error(`Unsupported credential key_version ${record.key_version}`);
  }

  const decipher = createDecipheriv("aes-256-gcm", encryption_key(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
