export function dkimAligned(authentication_results: string | null, from_domain: string | null): boolean | null {
  if (authentication_results === null || from_domain === null) {
    return null;
  }
  const verdict = authentication_results.match(/dkim=(\w+)[^;]*?header\.d=([^\s;]+)/i);
  if (verdict === null) {
    return null;
  }
  const [, result, signing_domain] = verdict;
  const normalized_signing_domain = signing_domain.toLowerCase().replace(/^"|"$/g, "");
  const normalized_from_domain = from_domain.toLowerCase();
  const aligned = normalized_signing_domain === normalized_from_domain || normalized_from_domain.endsWith(`.${normalized_signing_domain}`);
  return result.toLowerCase() === "pass" && aligned;
}
