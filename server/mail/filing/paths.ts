import type { PolicyScope } from "@server/mail/classify/rules";

// The logical path separator, which is NOT any server's hierarchy delimiter. A logical path is
// delimiter-free by construction and only server/mail/filing/render.ts is allowed to turn it into
// something a server understands — §6 says "paths are logical" and this is where that starts.
export const LOGICAL_SEPARATOR = "/";

export const CLIENTS_ROOT = "Clients";

// The write-side half of logicalPathFor's contract, exported as data rather than as a Zod schema so this
// module stays dependency-free and both validators can share one spelling. A client is ONE segment of a
// logical path; a separator inside it would inject folder hierarchy that logicalPathFor never sees and
// renderFolderPath would then refuse at execution time, after the policy was already stored. Two Zod
// schemas validate this input on the live path (the ORPC boundary and upsert_policy_schema), and a
// literal "/" in each is three spellings of one rule with nothing forcing them to agree — the exact
// shape that cost Phase 3 five fix rounds.
export const CLIENT_SEGMENT_RULE = {
  test: (value: string): boolean => !value.includes(LOGICAL_SEPARATOR),
  message: `a client name may not contain "${LOGICAL_SEPARATOR}": it is one segment of a logical path, and a separator here would let a policy inject folder hierarchy that logicalPathFor never sees.`,
} as const;

// The closed set of reasons a message reaches the filing queue instead of a folder. Exported as a tuple
// so the admin route and the Zod boundary can both derive from it rather than restating four strings.
export const FILING_QUEUE_REASONS = ["no_mapping", "dkim_unaligned", "ambiguous_client", "unresolvable_folder"] as const;
export type FilingQueueReason = (typeof FILING_QUEUE_REASONS)[number];

export type PolicyFilingMapping = { client: string | null; topic: string | null };

// Trims each segment and drops empties, so "Ops//Shopify " and " Ops/Shopify" render the same path and
// neither can produce a zero-length folder name. Returns null when nothing survives.
function normalizeSegments(raw: string): string[] | null {
  const segments = raw
    .split(LOGICAL_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.length === 0 ? null : segments;
}

// §6's axes, and the one place that knows how they compose.
//
//   client + topic  ->  Clients/<client>/<topic>
//   client          ->  Clients/<client>
//   topic           ->  <topic>, verbatim, and it MAY carry its own hierarchy
//   neither         ->  null
//
// The third branch is the one that needs justifying. Most of the seeded `file` traffic is records —
// tax, banking, travel, SaaS receipts — which have no client, and inventing one would make
// `Clients/Finances` a lie. Letting `topic` carry a slash-delimited path expresses `Finances`,
// `Ops/Shopify` and `Personal/Tennis` without a third column. The cost is that `topic` means two
// things depending on whether `client` is set, and the containment of that cost is this function:
// nothing else may split, join or interpret either column.
//
// `client` is never allowed to carry a separator — upsertPolicy rejects it at the Zod boundary, so a
// client cannot silently inject hierarchy — which is why only `topic` is passed through whole here.
export function logicalPathFor(mapping: PolicyFilingMapping): string | null {
  const client = mapping.client === null ? null : normalizeSegments(mapping.client);
  const topic = mapping.topic === null ? null : normalizeSegments(mapping.topic);

  if (client !== null) {
    const segments = topic === null ? [CLIENTS_ROOT, ...client] : [CLIENTS_ROOT, ...client, ...topic];
    return segments.join(LOGICAL_SEPARATOR);
  }

  if (topic !== null) {
    return topic.join(LOGICAL_SEPARATOR);
  }

  return null;
}

export type FilingGateInput = {
  logical_path: string | null;
  policy_scope: PolicyScope | null;
  dkim_aligned: boolean | null;
};

export type FilingDecision = { outcome: "file"; logical_path: string } | { outcome: "queue"; reason: FilingQueueReason; detail: string };

// §6's DKIM gate as amended 2026-08-20: it applies to `domain`-scoped policies only.
//
// The threat §6 names is that "@acmecorp.com decides where a message is permanently filed, so a spoofed
// From would let anyone write into a client's record folder" — a threat specific to a mapping keyed on a
// domain. An address-scoped policy is a line the operator typed for one exact address. Measured
// 2026-08-20: 40 of the 41 file policies are address-scoped, and gating them all would queue 1,617 of
// 2,390 filable messages, every one of them on the mailbox whose host stamps no Authentication-Results.
//
// `dkim_aligned !== true` rather than `=== false`: §6 queues DKIM "failing or absent", and absent is NULL.
//
// A null scope means no policy produced this decision. rules.ts step 5 can only ever derive `archive`,
// `keep_inbox` or `needs_action`, so a derived `file` cannot exist and a null scope here means the row
// carries a logical path with no policy behind it. It is left ungated rather than queued because the
// path had to come from somewhere, and queuing on a condition that cannot occur would be untestable.
export function filingDecisionFor(input: FilingGateInput): FilingDecision {
  if (input.logical_path === null) {
    return {
      outcome: "queue",
      reason: "no_mapping",
      detail:
        "the sender policy sets neither a client nor a topic, so §6 has no axis to file this on. Set one on the policy and resolve this row.",
    };
  }

  if (input.policy_scope === "domain" && input.dkim_aligned !== true) {
    return {
      outcome: "queue",
      reason: "dkim_unaligned",
      detail: `a domain-scoped policy chose ${input.logical_path}, and this message is not DKIM-aligned, so the From header deciding a permanent destination is exactly the spoofing risk §6 gates. Confirm the destination to file it anyway.`,
    };
  }

  return { outcome: "file", logical_path: input.logical_path };
}
