import { createHash, X509Certificate } from "node:crypto";
import type { ConnectionOptions, PeerCertificate } from "node:tls";
import { connect as tlsConnect } from "node:tls";
import type { TlsPolicy } from "@server/mail/types";

export type ObservedCertificate = {
  spki_sha256: string;
  issuer: string;
  subject: string;
  valid_from: string;
  valid_to: string;
  subject_alt_names: string[];
};

const PROBE_TIMEOUT_MS = 15_000;

export function spkiHashFromSpkiDer(spki_der: Buffer): string {
  return createHash("sha256").update(spki_der).digest("base64");
}

export function spkiHashFromCertificate(certificate_der: Buffer): string {
  const certificate = new X509Certificate(certificate_der);
  return spkiHashFromSpkiDer(certificate.publicKey.export({ type: "spki", format: "der" }));
}

export function describeCertificate(certificate: PeerCertificate): ObservedCertificate {
  const parsed = new X509Certificate(certificate.raw);
  return {
    spki_sha256: spkiHashFromSpkiDer(parsed.publicKey.export({ type: "spki", format: "der" })),
    issuer: parsed.issuer,
    subject: parsed.subject,
    valid_from: parsed.validFrom,
    valid_to: parsed.validTo,
    subject_alt_names: (parsed.subjectAltName ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  };
}

export function buildTlsOptions(input: { host: string; tls_policy: TlsPolicy; pinned_spki: string[] }): ConnectionOptions {
  if (input.tls_policy === "strict") {
    return { rejectUnauthorized: true, servername: input.host };
  }
  if (input.pinned_spki.length === 0) {
    throw new Error(`mailbox ${input.host} uses the pinned tls policy but has no pinned SPKI hash`);
  }
  const accepted = new Set(input.pinned_spki);
  return {
    // Chain validation stays on. Only the hostname check is replaced: the xneelo certificate is valid but
    // issued for the hosting server, not the vanity domain, and the SPKI survives ACME renewal while a
    // leaf fingerprint would not (§1.2). rejectUnauthorized is never turned off anywhere.
    rejectUnauthorized: true,
    servername: input.host,
    checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => {
      const observed = spkiHashFromCertificate(certificate.raw);
      if (accepted.has(observed)) {
        return undefined;
      }
      return new Error(`pinned SPKI mismatch for ${input.host}: server presented ${observed}`);
    },
  };
}

export function observeCertificate(input: { host: string; port: number }): Promise<ObservedCertificate> {
  return new Promise((resolve, reject) => {
    let observed: ObservedCertificate | null = null;

    const socket = tlsConnect(
      {
        host: input.host,
        port: input.port,
        servername: input.host,
        rejectUnauthorized: true,
        // The probe records the presented certificate from inside the identity check and then fails the
        // handshake on purpose. Reading it any other way would mean rejectUnauthorized: false, which §1.2
        // forbids outright.
        checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => {
          observed = describeCertificate(certificate);
          return new Error("certificate captured for operator re-pin review");
        },
      },
      () => {
        socket.destroy();
        reject(new Error(`unexpected accepted handshake while probing ${input.host}:${input.port}`));
      },
    );

    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`timed out probing ${input.host}:${input.port}`));
    });

    socket.once("error", () => {
      socket.destroy();
      if (observed !== null) {
        resolve(observed);
        return;
      }
      reject(new Error(`could not read a certificate from ${input.host}:${input.port}`));
    });
  });
}
