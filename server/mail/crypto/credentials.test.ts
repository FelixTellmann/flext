import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
process.env.JWT_SECRET = "x".repeat(32);
process.env.MAIL_ENCRYPTION_KEY = "a".repeat(64);
process.env.ADMIN_EMAIL = "test@example.com";

const { encryptCredential, decryptCredential } = await import("./credentials");

describe("credential encryption", () => {
  test("round-trips a password", () => {
    const record = encryptCredential("hunter2-app-password");
    expect(decryptCredential(record)).toBe("hunter2-app-password");
  });

  test("uses a distinct IV and ciphertext per call for identical input", () => {
    const first = encryptCredential("same-input");
    const second = encryptCredential("same-input");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  test("rejects tampered ciphertext", () => {
    const record = encryptCredential("hunter2");
    const bytes = Buffer.from(record.ciphertext, "base64");
    bytes[0] ^= 0xff;
    expect(() => decryptCredential({ ...record, ciphertext: bytes.toString("base64") })).toThrow();
  });

  test("rejects a tampered auth tag", () => {
    const record = encryptCredential("hunter2");
    const tag = Buffer.from(record.auth_tag, "base64");
    tag[0] ^= 0xff;
    expect(() => decryptCredential({ ...record, auth_tag: tag.toString("base64") })).toThrow();
  });

  test("rejects an unknown key_version", () => {
    const record = encryptCredential("hunter2");
    expect(() => decryptCredential({ ...record, key_version: 99 })).toThrow();
  });
});
