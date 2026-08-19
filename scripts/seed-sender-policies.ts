import { db } from "@server/db/drizzle";
import { sender } from "@server/db/schema";
import type { PolicyAction, PolicyScope } from "@server/mail/classify/rules";
import { POLICY_ACTIONS } from "@server/mail/classify/rules";
import { upsertPolicy } from "@server/mail/query/policies";
import { inArray } from "drizzle-orm";

// Seeds `sender_policy` from the hand-built triage in tmp/2026-08-18-mail-triage-run-1.md.
// Every row lands at autonomy "shadow" / source "operator" (§8) — the triage was human
// reasoning over the real mailboxes, not a machine proposal, and nothing here is promoted
// to "auto" by this script.
//
//   bun scripts/seed-sender-policies.ts             # dry run — prints the plan, writes nothing
//   bun scripts/seed-sender-policies.ts --apply     # writes the policies (operator only)

type SeedPolicy = {
  scope: PolicyScope;
  value: string;
  action: PolicyAction;
};

// Group A — dev/tooling notifications: machine-generated status pings, never replied to.
const DEV_TOOLING_NOTIFICATIONS: readonly string[] = [
  "notifications@github.com",
  "jira@getplatter.atlassian.net",
  "notifications@outbox.productive.io",
  "confluence@getplatter.atlassian.net",
  "noreply@wakatime.com",
  "notify@mail.notion.so",
  "support@npmjs.com",
  "notifications@vercel.com",
  "no-reply@fathom.video",
  "comments-wye5yczckqoreaa26brmgu@email.figma.com",
  "comments-ikd9x1pssmfggwgyg8hvmv@email.figma.com",
  "no-reply@email.figma.com",
  "noreply@tawk.to",
  "drive-shares-dm-noreply@google.com",
  "workspace-noreply@google.com",
  "no-reply@asana.com",
  "notifications@leapsome.net",
  "no-reply@github.com",
];

// Group B — PlanetScale, a service abandoned on 2026-08-09. Nothing here can ever need action again.
const DEAD_SERVICE_PLANETSCALE: readonly string[] = ["no-reply@planetscale.com", "marketing@planetscale.com", "support@planetscale.com"];

// Group C — DMARC aggregate reports, pure machine-to-machine XML.
const DMARC_AGGREGATE_REPORTS: readonly string[] = [
  "dmarcreport@microsoft.com",
  "noreply-dmarc-support@google.com",
  "noreply@dmarc.yahoo.com",
];

// Group D — marketing and newsletters. The triage document names 34 senders for this group but only
// gives exact addresses for 31 of them (the rest sit inside an "~200 combined" aggregate with no
// per-address breakdown) — seeding the unnamed ones would mean guessing addresses, so this list stops
// at what the document actually spells out.
const MARKETING_AND_NEWSLETTERS: readonly string[] = [
  "the-superpower@mail.beehiiv.com",
  "messages-noreply@linkedin.com",
  "groups-noreply@linkedin.com",
  "kent@epicai.pro",
  "kent@epicweb.dev",
  "team@epicweb.dev",
  "events@browserstack.com",
  "adam.bernard@browserstack.com",
  "newsletter@email.msccruises.de",
  "newsletter@e.msccruises.de",
  "news@email.minorhotels.com",
  "info@web.minor-hotels.com",
  "news@e.sunglasshut.com",
  "news@kaged.com",
  "newsletter@getwine.co.za",
  "hello@chess.com",
  "info@restaurantweek.co.za",
  "marcelle@labelorange.com",
  "info@mail-friendsandfamily.co.za",
  "no-reply@startupgrind.com",
  "grow@foundersintech.co.za",
  "do-not-reply@audible.com",
  "no-reply@property24.com",
  "info@e.atlassian.com",
  "noreply@email.openai.com",
  "robyn@procompare.co.za",
  "email@email.shopify.com",
  "noreply-travel@google.com",
  "info@email.meetup.com",
  "support@doveras.com",
  "hello@dineplan.com",
];

// Group E — financial records: banking, payments and vendor invoices. This is a tax and accounting
// trail, not noise, even though every one of these senders has never been replied to. It must resolve
// to `file`, never `archive` — the triage explicitly rejected archiving it, because filing keeps a
// year-end search trivial and archiving buries it exactly the way the operator does not want.
const FINANCIAL_RECORDS: readonly string[] = [
  "incontact@fnb.co.za",
  "fnbcheque@fnbstatements.co.za",
  "noreply@fnbstatements.co.za",
  "service@paypal.de",
  "no-reply@bobpay.co.za",
  "payments-noreply@google.com",
  "googleplay-noreply@google.com",
  "info@takealot.com",
  "noreply@sendgrid.com",
  "billing@shopify.com",
  "support@figma.com",
  "support+notifications@figma.com",
  "no_reply@email.apple.com",
  "billing@xneelo.com",
  "invoice+statements@mail.anthropic.com",
];

// Stripe's invoice sender is per-account (`invoice+statements+acct_*@stripe.com`), so there is no single
// concrete address to seed — a domain-scoped policy is the only way to cover it without guessing an
// account id. Still financial records, so `file`, not `archive`.
const FINANCIAL_RECORDS_DOMAINS: readonly string[] = ["stripe.com"];

// Group F — business operations: records of the businesses, not noise. Same file-not-archive rule as
// Group E, and for the same reason. `client` stays null on every row here — Phase 5 assigns clients.
const BUSINESS_OPERATIONS: readonly string[] = [
  "no-reply@listifyregistry.com",
  "no-reply@booknplay.co.za",
  "mailer@shopify.com",
  "support@bobgo.co.za",
  "contact-form@tellmann.co.za",
  "noreply@shopify.com",
  "partners@shopify.com",
  "reservations@mailer.dineplan.com",
  "app-audits@shopify.zendesk.com",
  "store+26179660@t.shopifyemail.com",
  "dailyclaims@discovery.co.za",
];

// Group G — leave alone. `alerts@logalert.app` is deliberately excluded: the operator has not decided
// whether error alerts belong in the inbox, so no policy is seeded for it. `no-reply@lunalemon.dev` is
// also excluded — the triage document's own correction says it "should probably stay in the inbox
// while tickets are live", which is a tentative lean, not a decision either.
const LEAVE_ALONE: readonly string[] = [
  "no-reply@accounts.google.com",
  "no-reply@squarespace.com",
  "no-reply-aws@amazon.com",
  "firebase-noreply@google.com",
];

const SEED_POLICIES: readonly SeedPolicy[] = [
  ...DEV_TOOLING_NOTIFICATIONS.map((value) => ({ scope: "address" as const, value, action: "archive" as const })),
  ...DEAD_SERVICE_PLANETSCALE.map((value) => ({ scope: "address" as const, value, action: "archive" as const })),
  ...DMARC_AGGREGATE_REPORTS.map((value) => ({ scope: "address" as const, value, action: "archive" as const })),
  ...MARKETING_AND_NEWSLETTERS.map((value) => ({ scope: "address" as const, value, action: "archive" as const })),
  ...FINANCIAL_RECORDS.map((value) => ({ scope: "address" as const, value, action: "file" as const })),
  ...FINANCIAL_RECORDS_DOMAINS.map((value) => ({ scope: "domain" as const, value, action: "file" as const })),
  ...BUSINESS_OPERATIONS.map((value) => ({ scope: "address" as const, value, action: "file" as const })),
  ...LEAVE_ALONE.map((value) => ({ scope: "address" as const, value, action: "keep_inbox" as const })),
];

function groupByAction(policies: readonly SeedPolicy[]): Map<PolicyAction, SeedPolicy[]> {
  const grouped = new Map<PolicyAction, SeedPolicy[]>();
  for (const policy of policies) {
    const list = grouped.get(policy.action) ?? [];
    list.push(policy);
    grouped.set(policy.action, list);
  }
  return grouped;
}

async function findMissingSenders(policies: readonly SeedPolicy[]): Promise<string[]> {
  const address_values = policies.filter((policy) => policy.scope === "address").map((policy) => policy.value);
  if (address_values.length === 0) {
    return [];
  }

  const found = await db.select({ address: sender.address }).from(sender).where(inArray(sender.address, address_values));
  const found_set = new Set(found.map((row) => row.address.toLowerCase()));

  return address_values.filter((value) => !found_set.has(value.toLowerCase()));
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const grouped = groupByAction(SEED_POLICIES);

  console.log(apply ? "Seeding sender policies — APPLYING" : "Seeding sender policies — DRY RUN (pass --apply to write)");
  console.log(`total policies: ${SEED_POLICIES.length}\n`);

  for (const action of POLICY_ACTIONS) {
    const list = grouped.get(action) ?? [];
    if (list.length === 0) {
      continue;
    }
    console.log(`${action}: ${list.length}`);
    for (const policy of list) {
      console.log(`  ${policy.scope === "domain" ? `@${policy.value}` : policy.value}`);
    }
    console.log("");
  }

  const missing = await findMissingSenders(SEED_POLICIES);
  const address_count = SEED_POLICIES.filter((policy) => policy.scope === "address").length;
  console.log(`sender check: ${address_count - missing.length} of ${address_count} address-scoped values found in the Sender table`);
  if (missing.length > 0) {
    console.log("not found:");
    for (const value of missing) {
      console.log(`  ${value}`);
    }
  }

  if (!apply) {
    console.log("\ndry run only — nothing was written. Re-run with --apply to write these policies.");
    process.exit(0);
  }

  console.log("");
  for (const policy of SEED_POLICIES) {
    const row = await upsertPolicy({
      scope: policy.scope,
      value: policy.value,
      action: policy.action,
      client: null,
      topic: null,
      autonomy: "shadow",
      source: "operator",
    });
    console.log(`upserted ${row.scope}:${row.value} -> ${row.action}`);
  }

  console.log(`\ndone: ${SEED_POLICIES.length} policies upserted.`);
  process.exit(0);
}

await main();
