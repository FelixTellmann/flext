// One header can carry several dkim= results — Gmail reports the sender's signature and the ESP's
// (sendgrid.info, amazonses.com) side by side — so every result is checked and the message counts as
// aligned if any passing signature belongs to the From domain. Reading only the first made the answer
// depend on the order the verifier happened to list them in.
const DKIM_RESULT_PATTERN = /dkim=(\w+)([^;]*)/gi;

export function dkimAligned(authentication_results: string | null, from_domain: string | null): boolean | null {
  if (authentication_results === null || from_domain === null) {
    return null;
  }

  const normalized_from_domain = from_domain.toLowerCase();
  let saw_signature = false;

  for (const [, result, attributes] of authentication_results.matchAll(DKIM_RESULT_PATTERN)) {
    // Gmail names the signing identity header.i, an AUID like "@example.com" or "user@example.com";
    // other verifiers use header.d, the bare SDID. Accept either and compare the domain part only.
    const identity = attributes.match(/header\.[di]=([^\s;]+)/i)?.[1];
    if (identity === undefined) {
      continue;
    }
    saw_signature = true;
    if (result.toLowerCase() !== "pass") {
      continue;
    }
    const signing_domain = identity.toLowerCase().replace(/^"|"$/g, "").replace(/^.*@/, "");
    if (signing_domain === normalized_from_domain || normalized_from_domain.endsWith(`.${signing_domain}`)) {
      return true;
    }
  }

  return saw_signature ? false : null;
}
