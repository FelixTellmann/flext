import type { MailboxFlavor } from "@server/mail/types";

export type IdentityMatcher = {
  matches: (address: string) => boolean;
};

export function normalizeAddress(address: string, flavor: MailboxFlavor): string {
  const trimmed = address.trim().toLowerCase();
  const separator = trimmed.lastIndexOf("@");
  if (separator < 1) {
    return trimmed;
  }
  const local = trimmed.slice(0, separator);
  const domain = trimmed.slice(separator + 1);
  if (flavor !== "gmail") {
    return `${local}@${domain}`;
  }
  // Gmail ignores everything after a "+" in the local part, so felix+invoices@ and felix@ are the same
  // inbox; treating them as different addresses silently empties the Needs Action queue for the alias (§1.10).
  const plus = local.indexOf("+");
  return `${plus === -1 ? local : local.slice(0, plus)}@${domain}`;
}

export function createIdentityMatcher(input: { patterns: string[]; flavor: MailboxFlavor }): IdentityMatcher {
  const exact = new Set<string>();
  const domains = new Set<string>();

  for (const pattern of input.patterns) {
    const normalized = pattern.trim().toLowerCase();
    if (normalized.length === 0) {
      continue;
    }
    if (normalized.startsWith("*@")) {
      domains.add(normalized.slice(2));
      continue;
    }
    if (normalized.startsWith("@")) {
      domains.add(normalized.slice(1));
      continue;
    }
    exact.add(normalizeAddress(normalized, input.flavor));
  }

  return {
    matches: (address: string) => {
      const normalized = normalizeAddress(address, input.flavor);
      if (exact.has(normalized)) {
        return true;
      }
      const separator = normalized.lastIndexOf("@");
      if (separator < 1) {
        return false;
      }
      return domains.has(normalized.slice(separator + 1));
    },
  };
}

export function isAddressedToMe(
  input: { to: string[]; delivered_to: string[]; x_original_to: string[] },
  matcher: IdentityMatcher,
): boolean {
  return [...input.to, ...input.delivered_to, ...input.x_original_to].some((address) => matcher.matches(address));
}

export function isCcMe(cc: string[], matcher: IdentityMatcher): boolean {
  return cc.some((address) => matcher.matches(address));
}
