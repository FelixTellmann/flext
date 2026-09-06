import type { PolicyScope } from "@server/mail/classify/rules";

// The logical path separator, which is NOT any server's hierarchy delimiter. A logical path is
// delimiter-free by construction and only server/mail/filing/render.ts is allowed to turn it into
// something a server understands — §6 says "paths are logical" and this is where that starts.
//
// Since 2026-09-06 (docs/decisions/2026-09-06-flat-folders.md) a logical path is exactly one segment, so
// the separator never appears in one logicalPathFor produces. It survives as the character the segment
// rule refuses, and as what render.ts splits on for the pre-flattening rows still stored in
// Action.target_path and FilingBinding.logical_path.
export const LOGICAL_SEPARATOR = "/";

// The write-side half of logicalPathFor's contract, exported as data rather than as a Zod schema so this
// module stays dependency-free and every validator can share one spelling. A client or a topic is ONE
// folder name; a separator inside either would ask for hierarchy that the flat-folders decision refuses,
// and renderFolderPath would then refuse at execution time, after the policy was already stored. Two Zod
// schemas validate this input on the live path (the ORPC boundary and upsert_policy_schema), and a
// literal "/" in each is three spellings of one rule with nothing forcing them to agree — the exact
// shape that cost Phase 3 five fix rounds.
export const FOLDER_SEGMENT_RULE = {
  test: (value: string): boolean => !value.includes(LOGICAL_SEPARATOR),
  message: `a client or topic may not contain "${LOGICAL_SEPARATOR}": every folder is one name with no nesting, so a separator here would ask for folder hierarchy that filing never creates.`,
} as const;

// The closed set of reasons a message reaches the filing queue instead of a folder. Exported as a tuple
// so the admin route and the Zod boundary can both derive from it rather than restating four strings.
export const FILING_QUEUE_REASONS = ["no_mapping", "dkim_unaligned", "ambiguous_client", "unresolvable_folder"] as const;
export type FilingQueueReason = (typeof FILING_QUEUE_REASONS)[number];

// The one place a queued reason is turned into the string that lands in `Action.error`. `unresolvable_folder`
// is the only reason produced outside this module — the executor and undo raise it when a path cannot be
// resolved to a folder — and routing it through here makes a typo a compile error rather than a row whose
// reason Task 9's queue UI silently fails to render.
export function filingQueueReason(reason: FilingQueueReason, detail: string): string {
  return `${reason}: ${detail}`;
}

export type PolicyFilingMapping = { client: string | null; topic: string | null };

// One folder name from a column value. Trims, and keeps only the LAST separator-delimited segment, so a
// row stored before the flat-folders decision ("Personal/Travel", "Ops//Shopify ") renders the same
// name tmp/flatten-filing-policies.ts rewrites it to ("Travel", "Shopify") rather than a nested path.
// Returns null when nothing survives, so a blank column can never name a zero-length folder.
function folderNameFor(raw: string): string | null {
  const segments = raw
    .split(LOGICAL_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.at(-1) ?? null;
}

// §6's axes as flattened on 2026-09-06: one folder name, no roots, no nesting.
//
//   client + topic  ->  <client>
//   client          ->  <client>
//   topic           ->  <topic>
//   neither         ->  null
//
// The client wins when both are set because it is the more specific fact about the sender — a topic on a
// client rule ("Invoices") describes what the mail is, the client says whose it is, and the operator reads
// folder counts per client. Nothing else may split, join or interpret either column.
export function logicalPathFor(mapping: PolicyFilingMapping): string | null {
  const client = mapping.client === null ? null : folderNameFor(mapping.client);
  if (client !== null) {
    return client;
  }
  return mapping.topic === null ? null : folderNameFor(mapping.topic);
}

export type FilingGateInput = {
  logical_path: string | null;
  policy_scope: PolicyScope | null;
  dkim_aligned: boolean | null;
  // Action.filingConfirmedAt: non-null once the operator resolved this row out of the filing queue.
  // Required rather than optional so no call site can forget it and silently re-gate a confirmed row.
  filing_confirmed_at: Date | null;
};

export type FilingDecision = { outcome: "file"; logical_path: string } | { outcome: "queue"; reason: FilingQueueReason; detail: string };

// §6's DKIM gate as amended 2026-08-20: an EXPLICIT `address` scope is the only thing that un-gates it.
//
// The threat §6 names is that "@acmecorp.com decides where a message is permanently filed, so a spoofed
// From would let anyone write into a client's record folder" — a threat specific to a mapping keyed on a
// domain. An address-scoped policy is a line the operator typed for one exact address. Measured
// 2026-08-20: 40 of the 41 file policies are address-scoped, and gating them all would queue 1,617 of
// 2,390 filable messages, every one of them on the mailbox whose host stamps no Authentication-Results.
//
// `dkim_aligned !== true` rather than `=== false`: §6 queues DKIM "failing or absent", and absent is NULL.
//
// The test is written as "not address" rather than "is domain" because a null scope DOES occur and must
// fail CLOSED. deletePolicy hard-deletes and Action.senderPolicyId carries an index but no foreign key, so
// a `file` row proposed by a domain-scoped policy that has since been deleted loads with a null scope: the
// left join that correctly keeps the row reportable is the same join that would otherwise strip its gate.
// Unknown provenance is treated as the stricter case, because the gate exists to stop a spoofed From from
// writing into a records folder and the operator can still confirm the destination to file it anyway.
//
// That last sentence is only true because `filing_confirmed_at` short-circuits the DKIM branch below.
// DKIM alignment is a PROXY for "someone trustworthy vouched for this destination"; a human who read the
// sender and chose the folder is the thing that proxy stands in for, so the confirmation supersedes it.
// Without the short-circuit the gate re-reads the same scope and DKIM state on the next run and re-queues
// the row the operator just resolved, which makes a dkim_unaligned row permanently unfilable.
//
// It supersedes the DKIM branch ONLY. Confirmation cannot conjure a path, so `no_mapping` still gates: a
// confirmed row normally carries a target_path, and one that somehow does not still has nowhere to go.
// Nor can it conjure a folder — `unresolvable_folder` is raised downstream by the resolver, and a server
// that refuses to create the folder refuses no matter who asked for it.
export function filingDecisionFor(input: FilingGateInput): FilingDecision {
  if (input.logical_path === null) {
    return {
      outcome: "queue",
      reason: "no_mapping",
      detail:
        "the sender policy sets neither a client nor a topic, so §6 has no axis to file this on. Set one on the policy and resolve this row.",
    };
  }

  if (input.filing_confirmed_at === null && input.policy_scope !== "address" && input.dkim_aligned !== true) {
    const chooser = input.policy_scope === null ? "a policy that no longer exists" : "a domain-scoped policy";
    return {
      outcome: "queue",
      reason: "dkim_unaligned",
      detail: `${chooser} chose ${input.logical_path}, and this message is not DKIM-aligned, so the From header deciding a permanent destination is exactly the spoofing risk §6 gates. Confirm the destination to file it anyway.`,
    };
  }

  return { outcome: "file", logical_path: input.logical_path };
}
