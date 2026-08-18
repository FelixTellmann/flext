import { describe, expect, test } from "bun:test";
import { deriveSignals, volumeBucket } from "@server/mail/classify/signals";

const base = {
  list_id: null,
  list_unsubscribe: null,
  precedence: null,
  auto_submitted: null,
  from_address: "person@example.com",
  to_me: true,
  cc_me: false,
  dkim_aligned: true,
  internal_date: new Date("2026-08-01T00:00:00Z"),
  sender_message_count: 1,
  my_reply_count: 0,
  now: new Date("2026-08-11T00:00:00Z"),
};

describe("volumeBucket", () => {
  test("uses the §5.1 boundaries", () => {
    expect(volumeBucket(0)).toBe("low");
    expect(volumeBucket(9)).toBe("low");
    expect(volumeBucket(10)).toBe("medium");
    expect(volumeBucket(99)).toBe("medium");
    expect(volumeBucket(100)).toBe("high");
    expect(volumeBucket(999)).toBe("high");
    expect(volumeBucket(1000)).toBe("flood");
  });
});

describe("deriveSignals", () => {
  test("List-Id alone marks bulk", () => {
    expect(deriveSignals({ ...base, list_id: "<news.example.com>" }).is_bulk).toBe(true);
  });

  test("Precedence: urgent is not bulk", () => {
    expect(deriveSignals({ ...base, precedence: "urgent" }).is_bulk).toBe(false);
  });

  test("Precedence: bulk is bulk, case-insensitively", () => {
    expect(deriveSignals({ ...base, precedence: "Bulk" }).is_bulk).toBe(true);
  });

  test("a no-reply sender is automated without Auto-Submitted", () => {
    expect(deriveSignals({ ...base, from_address: "No-Reply@example.com" }).is_automated).toBe(true);
  });

  test("sender_known follows my_reply_count", () => {
    expect(deriveSignals({ ...base, my_reply_count: 0 }).sender_known).toBe(false);
    expect(deriveSignals({ ...base, my_reply_count: 1 }).sender_known).toBe(true);
  });

  test("age_days counts whole days and never goes negative", () => {
    expect(deriveSignals(base).age_days).toBe(10);
    expect(deriveSignals({ ...base, internal_date: new Date("2026-08-12T00:00:00Z") }).age_days).toBe(0);
  });
});
