import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { buildTlsOptions, spkiHashFromSpkiDer } from "./tls";

test("spkiHashFromSpkiDer is the base64 sha256 of the DER SubjectPublicKeyInfo", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const spki_der = publicKey.export({ type: "spki", format: "der" });

  expect(spkiHashFromSpkiDer(spki_der)).toBe(createHash("sha256").update(spki_der).digest("base64"));
});

test("strict policy keeps the default hostname check and never disables verification", () => {
  const options = buildTlsOptions({ host: "imap.gmail.com", tls_policy: "strict", pinned_spki: [] });

  expect(options.rejectUnauthorized).toBe(true);
  expect(options.checkServerIdentity).toBeUndefined();
});

test("pinned policy accepts a pinned hash and rejects anything else", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const spki_der = publicKey.export({ type: "spki", format: "der" });
  const pinned = spkiHashFromSpkiDer(spki_der);
  const options = buildTlsOptions({ host: "mail.example.com", tls_policy: "pinned", pinned_spki: [pinned] });

  expect(options.rejectUnauthorized).toBe(true);
  expect(typeof options.checkServerIdentity).toBe("function");
});

test("pinned policy without a pinned hash is a hard error", () => {
  expect(() => buildTlsOptions({ host: "mail.example.com", tls_policy: "pinned", pinned_spki: [] })).toThrow();
});
