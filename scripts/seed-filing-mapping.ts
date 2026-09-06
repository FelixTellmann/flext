import { db } from "@server/db/drizzle";
import { filingBinding, mailbox, senderPolicy } from "@server/db/schema";
import type { PolicyScope } from "@server/mail/classify/rules";
import { CLIENT_SEGMENT_RULE, CLIENTS_ROOT, LOGICAL_SEPARATOR, logicalPathFor } from "@server/mail/filing/paths";
import type { PolicyIndex, PolicyRow } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import { eq } from "drizzle-orm";

// Seeds `client`/`topic` on the 103 sender policies (from tmp/2026-08-18-mail-triage-run-1.md), and the
// FilingBinding rows for felix@tellmann.co.za's thirteen hand-built folders. Task 11 of Phase 5.
//
//   bun scripts/seed-filing-mapping.ts             # dry run — prints the plan, writes nothing
//   bun scripts/seed-filing-mapping.ts --apply     # writes the mapping and bindings (operator only)
//
// THE TRAP: the mapping table's left column is a LOGICAL PATH, not a column value. `client =
// "Clients/Listify"` is rejected by upsertPolicy's Zod refine (a client is one segment), and `topic =
// "Clients/Listify"` would silently render `Clients/Clients/Listify`. columnsForPath() below is the one
// place that turns a path into columns: a `Clients/<name>` path sets `client`, everything else sets
// `topic` verbatim. Every mapping AND every binding is asserted against logicalPathFor() before anything
// is printed or written, so a wrong split fails loudly here rather than shipping a silently wrong folder.
//
// NO Finances/Tax split: `noreply@sars.gov.za` and `donotreply@usvisa-info.com` go to `Finances` with
// the rest of the financial records, not a `Finances/Tax` sub-path. Bindings match a logical path
// EXACTLY and a sub-path does not inherit its parent's binding — `Finances` is bound to
// `INBOX.Finances - Ref`, so `Finances/Tax` would render as `INBOX.Finances.Tax`, a folder under a
// different parent than the one the operator's Finances binding points at. The design spec splits by
// topic only where volume earns it, and two senders don't.
//
// `contact-form@tellmann.co.za` is `file`-classed but deliberately NOT mapped anywhere below: it's
// inbound leads from the operator's own site, and the triage doc calls it "worth a look before filing" —
// the one `file` policy whose destination is a judgement call the operator hasn't made yet. It queues as
// `no_mapping`, which is the correct, visible outcome. Do not add a mapping for it without that decision
// being made first.
//
// APPLY SAFETY: migration 0006 (which creates FilingBinding) is not applied in the live database as of
// this writing. Nothing in this repo uses db.transaction (grep confirms), and this script writes two
// kinds of row — a SenderPolicy mapping and a FilingBinding — that only make sense together: a mapped
// logical path with no binding renders fresh and CREATES a new folder next to the operator's real one
// (e.g. `INBOX.Finances` beside the real `INBOX.Finances - Ref`, which holds 99 messages). So `--apply`
// (a) preflights that FilingBinding actually exists before writing anything, and (b) wraps every write in
// one transaction, so a failure partway through leaves the database exactly as it was rather than half
// the mapping committed with no bindings to match it.

type MappingSender = { scope: PolicyScope; value: string };

function address(value: string): MappingSender {
  return { scope: "address", value };
}

function domain(value: string): MappingSender {
  return { scope: "domain", value };
}

type MappingGroup = { path: string; senders: readonly MappingSender[] };

const CLIENTS_LISTIFY: readonly MappingSender[] = [
  address("no-reply@listifyregistry.com"),
  address("noreply@shopify.com"),
  address("partners@shopify.com"),
  address("app-audits@shopify.zendesk.com"),
  // Currently a keep_inbox policy (§8's Group G): tickets stay in the inbox while they're live, per the
  // triage doc's correction. Setting client here is a reference marker for later, not a routing change —
  // filing only ever consults client/topic on a `file`-classed action, and this row's action is
  // untouched by this script.
  address("no-reply@lunalemon.dev"),
];

const CLIENTS_KIDSLIVING: readonly MappingSender[] = [address("support@bobgo.co.za")];

const OPS_SHOPIFY: readonly MappingSender[] = [address("mailer@shopify.com"), address("store+26179660@t.shopifyemail.com")];

// The sixteen Group E senders (financial records: banking, payments, vendor invoices) plus all six
// Group H tax/banking/legal senders — SARS and the US visa fee join Carta, Deel, DKB and Wise, because a
// cap table, contractor payments, a German bank and an international payments provider belong with FNB,
// PayPal and Stripe for the same reason: a filed, never-archived accounting trail. None of them get a
// Finances/Tax split — see the file-level comment.
const FINANCES: readonly MappingSender[] = [
  address("incontact@fnb.co.za"),
  address("fnbcheque@fnbstatements.co.za"),
  address("noreply@fnbstatements.co.za"),
  address("service@paypal.de"),
  address("no-reply@bobpay.co.za"),
  address("payments-noreply@google.com"),
  address("googleplay-noreply@google.com"),
  address("info@takealot.com"),
  domain("stripe.com"),
  address("noreply@sendgrid.com"),
  address("billing@shopify.com"),
  address("support@figma.com"),
  address("support+notifications@figma.com"),
  address("no_reply@email.apple.com"),
  address("billing@xneelo.com"),
  address("invoice+statements@mail.anthropic.com"),
  address("noreply@sars.gov.za"),
  address("donotreply@usvisa-info.com"),
  address("noreply@wise.com"),
  address("no-reply@carta.com"),
  address("no-reply@deel.support"),
  address("noreply@dkb.de"),
];

const PERSONAL_TENNIS: readonly MappingSender[] = [address("no-reply@booknplay.co.za")];
const PERSONAL_RESTAURANTS: readonly MappingSender[] = [address("reservations@mailer.dineplan.com")];
const PERSONAL_MEDICAL: readonly MappingSender[] = [address("dailyclaims@discovery.co.za")];

const PERSONAL_TRAVEL: readonly MappingSender[] = [
  address("noreply@booking.com"),
  address("noreply@uber.com"),
  address("noreply@deutschebahn.com"),
  address("noreply@oebb.at"),
  address("donotreply@easyjet.com"),
  address("no-reply@flyairlink.com"),
  address("noreply@doc.mail.amadeus.com"),
  address("no-reply@webtickets.co.za"),
];

const MAPPING_GROUPS: readonly MappingGroup[] = [
  { path: "Clients/Listify", senders: CLIENTS_LISTIFY },
  { path: "Clients/KidsLiving", senders: CLIENTS_KIDSLIVING },
  { path: "Ops/Shopify", senders: OPS_SHOPIFY },
  { path: "Finances", senders: FINANCES },
  { path: "Personal/Tennis", senders: PERSONAL_TENNIS },
  { path: "Personal/Restaurants", senders: PERSONAL_RESTAURANTS },
  { path: "Personal/Medical", senders: PERSONAL_MEDICAL },
  { path: "Personal/Travel", senders: PERSONAL_TRAVEL },
];

// The one place a mapping table's left column becomes `client`/`topic` columns. See the file-level
// comment for why this can't be done any other way.
function columnsForPath(path: string): { client: string | null; topic: string | null } {
  const clients_prefix = `${CLIENTS_ROOT}${LOGICAL_SEPARATOR}`;
  if (path.startsWith(clients_prefix)) {
    return { client: path.slice(clients_prefix.length), topic: null };
  }
  return { client: null, topic: path };
}

type SeedMapping = { scope: PolicyScope; value: string; client: string | null; topic: string | null; intended_path: string };

const SEED_MAPPINGS: readonly SeedMapping[] = MAPPING_GROUPS.flatMap((group) => {
  const columns = columnsForPath(group.path);
  return group.senders.map((sender) => ({ scope: sender.scope, value: sender.value, ...columns, intended_path: group.path }));
});

// Fails loudly rather than shipping a silently wrong folder: every mapping must round-trip through the
// same function filing/resolver.ts calls at execution time.
function assertMappingsRoundTrip(mappings: readonly SeedMapping[]): void {
  for (const mapping of mappings) {
    const derived = logicalPathFor({ client: mapping.client, topic: mapping.topic });
    if (derived !== mapping.intended_path) {
      throw new Error(
        `mapping for ${mapping.scope}:${mapping.value} derives "${derived}" from client=${JSON.stringify(mapping.client)} topic=${JSON.stringify(mapping.topic)}, but the intended path is "${mapping.intended_path}"`,
      );
    }
  }
}

// The bindings half of the same round trip, and the reason it exists: the resolver matches a binding
// EXACTLY (Ruling 3), so a one-character typo in a logical_path here is silent and inert — nothing ever
// matches it, the path renders instead, and createFolder mints a brand-new folder beside the operator's
// real one. That is the harm the --apply preflight was added to prevent, arriving through the other door.
// Asserting the path derives from columnsForPath is what turns "bound but unmatchable" into a loud
// failure at the top of the script, before anything is printed or written.
//
// NOT asserted: that some mapping targets the path. Ruling 4 keeps `Personal -> INBOX.Personal` bound
// with no policy pointing at it, deliberately, as documentation of an existing folder for a later mapping
// edit. So an unmatched binding is REPORTED rather than refused, and the operator judges each one.
function assertBindingsRoundTrip(bindings: readonly Binding[]): void {
  for (const binding of bindings) {
    const derived = logicalPathFor(columnsForPath(binding.logical_path));
    if (derived !== binding.logical_path) {
      throw new Error(
        `binding "${binding.logical_path}" -> "${binding.folder}" is not a derivable logical path: columnsForPath + logicalPathFor produce ${JSON.stringify(derived)}. Nothing would ever match it, so the path would render into a fresh folder next to "${binding.folder}".`,
      );
    }
  }
}

function mappingGroupsTargeting(logical_path: string): readonly MappingGroup[] {
  return MAPPING_GROUPS.filter((group) => group.path === logical_path);
}

type ResolvedMapping = SeedMapping & { existing: PolicyRow | null };

function resolveMappings(index: PolicyIndex, mappings: readonly SeedMapping[]): ResolvedMapping[] {
  return mappings.map((mapping) => {
    const target_map = mapping.scope === "address" ? index.by_address : index.by_domain;
    return { ...mapping, existing: target_map.get(mapping.value.toLowerCase()) ?? null };
  });
}

function findUnmappedFilePolicies(index: PolicyIndex, mapped_keys: ReadonlySet<string>): PolicyRow[] {
  const all_policies = [...index.by_address.values(), ...index.by_domain.values()];
  return all_policies
    .filter((row) => row.action === "file" && !mapped_keys.has(`${row.scope}:${row.value.toLowerCase()}`))
    .sort((a, b) => a.value.localeCompare(b.value));
}

// felix@tellmann.co.za only — the three Gmail mailboxes have no user labels at all, so every path
// renders fresh and is created on first use, and needs no binding.
const TELLMANN_MAILBOX_LABEL = "felix@tellmann.co.za";

type Binding = { logical_path: string; folder: string };

const BINDINGS: readonly Binding[] = [
  { logical_path: "Clients/KidsLiving", folder: "INBOX.KidsLiving" },
  { logical_path: "Clients/Broadwayjewellers", folder: "INBOX.Broadwayjewellers" },
  { logical_path: "Clients/VW", folder: "INBOX.VW" },
  { logical_path: "Clients/Moritz", folder: "INBOX.Moritz" },
  { logical_path: "Finances", folder: "INBOX.Finances - Ref" },
  { logical_path: "Ops/Invoices", folder: "INBOX.Invoices" },
  { logical_path: "Personal/Travel", folder: "INBOX.Travel" },
  { logical_path: "Personal", folder: "INBOX.Personal" },
];

// No sender policy points at these: binding a path nothing files to is a mapping that can only be wrong
// later, so they stay unbound on purpose. Listed here so the omission is visible, not silent.
const DELIBERATELY_UNBOUND_FOLDERS: readonly string[] = ["INBOX.docs", "INBOX.Tellmann", "INBOX.Move Knysna - CPT 2020"];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  assertMappingsRoundTrip(SEED_MAPPINGS);
  assertBindingsRoundTrip(BINDINGS);

  const index = await loadPolicyIndex();
  const resolved = resolveMappings(index, SEED_MAPPINGS);
  const missing = resolved.filter((mapping) => mapping.existing === null);

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} mapped sender(s) have no existing SenderPolicy row, so their action can't be preserved: ${missing
        .map((mapping) => `${mapping.scope}:${mapping.value}`)
        .join(", ")}. Run scripts/seed-sender-policies.ts first, or check the address for a typo.`,
    );
  }

  console.log(apply ? "Seeding filing mapping — APPLYING" : "Seeding filing mapping — DRY RUN (pass --apply to write)");
  console.log(`total mapped senders: ${SEED_MAPPINGS.length}\n`);

  console.log("=== Mapping: client/topic on existing sender policies ===\n");
  for (const group of MAPPING_GROUPS) {
    const columns = columnsForPath(group.path);
    console.log(`${group.path}  (client=${columns.client ?? "null"}, topic=${JSON.stringify(columns.topic)})`);
    for (const mapping of resolved) {
      if (mapping.intended_path !== group.path) {
        continue;
      }
      const existing = mapping.existing as PolicyRow;
      const derived_path = logicalPathFor({ client: mapping.client, topic: mapping.topic });
      const flag = existing.action === "file" ? "" : `  <- currently "${existing.action}", not "file"; client/topic set for reference only`;
      console.log(`  ${mapping.scope === "domain" ? `@${mapping.value}` : mapping.value}  ->  ${derived_path}${flag}`);
    }
    console.log("");
  }

  const mapped_keys = new Set(SEED_MAPPINGS.map((mapping) => `${mapping.scope}:${mapping.value.toLowerCase()}`));
  const unmapped_file_policies = findUnmappedFilePolicies(index, mapped_keys);
  const total_file_policies = [...index.by_address.values(), ...index.by_domain.values()].filter((row) => row.action === "file").length;

  console.log(
    `sender check: all ${SEED_MAPPINGS.length} mapped senders have an existing SenderPolicy row (looked up in the live SenderPolicy table)`,
  );
  console.log(
    `\n=== Unmapped "file" senders — the mapping table does not name them, so they keep client/topic null and queue as no_mapping ===`,
  );
  console.log(`${unmapped_file_policies.length} of ${total_file_policies} file-action policies left unmapped:`);
  for (const row of unmapped_file_policies) {
    console.log(`  ${row.scope === "domain" ? `@${row.value}` : row.value}`);
  }

  console.log("\n=== Bindings: felix@tellmann.co.za only ===\n");
  const [tellmann] = await db.select({ id: mailbox.id }).from(mailbox).where(eq(mailbox.label, TELLMANN_MAILBOX_LABEL)).limit(1);
  if (tellmann === undefined) {
    throw new Error(
      `no Mailbox row with label "${TELLMANN_MAILBOX_LABEL}" — bindings can't be written without a mailbox to attach them to.`,
    );
  }
  console.log(`mailbox: ${TELLMANN_MAILBOX_LABEL} (id ${tellmann.id})\n`);
  console.log("every logical path below round-trips through columnsForPath + logicalPathFor, so the resolver's exact match can find it.\n");
  const inert_bindings: Binding[] = [];
  for (const binding of BINDINGS) {
    const targeting = mappingGroupsTargeting(binding.logical_path);
    if (targeting.length === 0) {
      inert_bindings.push(binding);
      console.log(`  ${binding.logical_path}  ->  ${binding.folder}    (INERT: no mapping group targets this path)`);
      continue;
    }
    const senders = targeting.flatMap((group) => group.senders);
    console.log(`  ${binding.logical_path}  ->  ${binding.folder}    (targeted by ${senders.length} mapped sender(s))`);
  }
  console.log(
    `\n${BINDINGS.length} bindings for ${TELLMANN_MAILBOX_LABEL}. No bindings for the three Gmail mailboxes: no user labels to preserve.`,
  );

  // Not a failure. Ruling 4 keeps an inert binding on purpose — it documents an existing folder for a
  // later mapping edit — so this is the operator's judgement call, one binding at a time. What it is NOT
  // allowed to hide is a typo: a mistyped path would also show up here as inert, which is exactly why the
  // list is printed rather than summed.
  if (inert_bindings.length > 0) {
    console.log(
      `\n${inert_bindings.length} of ${BINDINGS.length} bindings are inert — no mapped sender files to them, so they write a FilingBinding row nothing resolves:`,
    );
    for (const binding of inert_bindings) {
      console.log(`  ${binding.logical_path}  ->  ${binding.folder}`);
    }
    console.log("  Deliberate for a folder kept as documentation; a typo otherwise. Check each against the mapping table above.");
  }

  console.log("\nDeliberately left unbound (no sender policy points at them yet, so binding them now could only ever be wrong later):");
  for (const folder of DELIBERATELY_UNBOUND_FOLDERS) {
    console.log(`  ${folder}`);
  }

  console.log(
    "\nnote: migration 0006 (which creates FilingBinding) is not applied in the live database yet, so this dry run does not query FilingBinding — the plan above is derived entirely from the mapping and Mailbox tables.",
  );

  if (!apply) {
    console.log("\ndry run only — nothing was written. Re-run with --apply to write these policies and bindings.");
    process.exit(0);
  }

  // Preflight, before the first write: FilingBinding (migration 0006) must exist, or a mapping commits
  // with no binding to match it and filing renders a brand-new folder next to the operator's real one.
  // Runs before the policy loop below, not between the policy and binding loops — the whole point is to
  // never let the mapping half land without the binding half able to follow it.
  try {
    await db.select({ id: filingBinding.id }).from(filingBinding).limit(1);
  } catch (error) {
    throw new Error(
      `FilingBinding does not exist yet (migration 0006 is unapplied), so --apply would commit all ${resolved.length} policy mappings and then fail on the first binding insert — mapped-but-unbound paths render into fresh folders next to the operator's real ones. Run "bun run db:migrate" first, then re-run with --apply. Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log("");
  // Backstop for every other partial failure: policies and bindings only make sense written together, so
  // both loops run inside one transaction and either both land or neither does.
  await db.transaction(async (tx) => {
    for (const mapping of resolved) {
      const existing = mapping.existing as PolicyRow;
      if (mapping.client !== null && !CLIENT_SEGMENT_RULE.test(mapping.client)) {
        throw new Error(CLIENT_SEGMENT_RULE.message);
      }
      const now = new Date();
      const values = {
        scope: mapping.scope,
        value: mapping.value,
        action: existing.action,
        client: mapping.client,
        topic: mapping.topic,
        autonomy: existing.autonomy,
        source: existing.source,
        suspended_at: existing.suspended_at,
        suspension_reason: existing.suspension_reason,
        updatedAt: now,
      };
      await tx
        .insert(senderPolicy)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            action: values.action,
            client: values.client,
            topic: values.topic,
            autonomy: values.autonomy,
            source: values.source,
            suspended_at: values.suspended_at,
            suspension_reason: values.suspension_reason,
            updatedAt: values.updatedAt,
          },
        });
      console.log(`updated ${mapping.scope}:${mapping.value} -> client=${mapping.client ?? "null"} topic=${mapping.topic ?? "null"}`);
    }

    console.log("");
    for (const binding of BINDINGS) {
      const now = new Date();
      await tx
        .insert(filingBinding)
        .values({ mailbox_id: tellmann.id, logical_path: binding.logical_path, folder: binding.folder, updatedAt: now })
        .onDuplicateKeyUpdate({ set: { folder: binding.folder, updatedAt: now } });
      console.log(`upserted binding ${binding.logical_path} -> ${binding.folder}`);
    }
  });

  console.log(
    `\ndone: ${resolved.length} policies updated, ${BINDINGS.length} bindings upserted for ${TELLMANN_MAILBOX_LABEL}, all in one transaction.`,
  );
  process.exit(0);
}

await main();
