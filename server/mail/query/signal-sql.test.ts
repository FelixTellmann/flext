import { describe, expect, test } from "bun:test";
import { AUTOMATED_LOCAL_PART_PATTERN, deriveSignals } from "@server/mail/classify/signals";
import { isAutomatedSql, resolveThreadState } from "@server/mail/query/signal-sql";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const now = new Date("2026-08-19T12:00:00Z");
const past = new Date("2026-08-18T12:00:00Z");
const future = new Date("2026-08-20T12:00:00Z");

describe("resolveThreadState", () => {
  test("an absent ThreadState row is open", () => {
    expect(resolveThreadState({ state: null, snoozed_until: null, now })).toBe("open");
  });

  test("a snooze whose deadline has passed is open again", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: past, now })).toBe("open");
  });

  test("a snooze that expires exactly now is open again, matching isThreadOpenSql's snoozed_until > now", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: now, now })).toBe("open");
  });

  test("a snooze with a future deadline stays snoozed", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: future, now })).toBe("snoozed");
  });

  test("a snooze with no deadline never expires", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: null, now })).toBe("snoozed");
  });

  test("done and dismissed are unaffected by any deadline left behind", () => {
    expect(resolveThreadState({ state: "done", snoozed_until: null, now })).toBe("done");
    expect(resolveThreadState({ state: "done", snoozed_until: past, now })).toBe("done");
    expect(resolveThreadState({ state: "dismissed", snoozed_until: null, now })).toBe("dismissed");
    expect(resolveThreadState({ state: "dismissed", snoozed_until: past, now })).toBe("dismissed");
  });

  test("open stays open", () => {
    expect(resolveThreadState({ state: "open", snoozed_until: null, now })).toBe("open");
  });

  test("a state the column should never hold reads as open rather than passing through", () => {
    expect(resolveThreadState({ state: "archived", snoozed_until: null, now })).toBe("open");
  });
});

// The SQL half cannot be executed here (there is no dev database), so the test asserts the thing that
// actually went wrong: the two halves classifying the same address differently. It renders isAutomatedSql,
// takes the regex MySQL will be handed as a bound parameter, and runs THAT against each address rather
// than the constant the TypeScript half compiles — a copy-paste divergence between the two would show up
// as a mismatch here. MySQL 8.4's REGEXP is an unanchored search over an ICU pattern, matching
// RegExp.test, and both halves lowercase their input first.
describe("isAutomatedSql agrees with deriveSignals", () => {
  const rendered = new MySqlDialect().sqlToQuery(isAutomatedSql());
  const bound_pattern = rendered.params.find((param) => typeof param === "string" && param.startsWith("^("));
  const sql_matches = (from_address: string | null, auto_submitted: string | null): boolean => {
    if (auto_submitted !== null) {
      return true;
    }
    return new RegExp(String(bound_pattern)).test((from_address ?? "").toLowerCase());
  };
  const ts_matches = (from_address: string | null, auto_submitted: string | null): boolean =>
    deriveSignals({
      list_id: null,
      list_unsubscribe: null,
      precedence: null,
      auto_submitted,
      from_address,
      to_me: true,
      cc_me: false,
      dkim_aligned: null,
      internal_date: past,
      sender_message_count: 1,
      my_reply_count: 0,
      now,
    }).is_automated;

  test("the local-part list is bound as a parameter, not interpolated into the statement", () => {
    expect(bound_pattern).toBe(AUTOMATED_LOCAL_PART_PATTERN);
    expect(rendered.sql).toContain("REGEXP ?");
  });

  test("an Auto-Submitted header alone makes a message automated in both halves", () => {
    expect(sql_matches("person@example.com", "auto-generated")).toBe(true);
    expect(ts_matches("person@example.com", "auto-generated")).toBe(true);
  });

  for (const address of ["no-reply@fnbstatements.co.za", "noreply@fnbstatements.co.za", "MAILER-DAEMON@example.com"]) {
    test(`${address} is automated in both halves with a null Auto-Submitted`, () => {
      expect(sql_matches(address, null)).toBe(true);
      expect(ts_matches(address, null)).toBe(true);
    });
  }

  for (const address of ["felix@tellmann.co.za", "no-reply-team@example.com", null]) {
    test(`${address ?? "a null address"} is not automated in either half`, () => {
      expect(sql_matches(address, null)).toBe(false);
      expect(ts_matches(address, null)).toBe(false);
    });
  }
});
