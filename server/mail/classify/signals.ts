export type VolumeBucket = "low" | "medium" | "high" | "flood";

export type SignalInput = {
  list_id: string | null;
  list_unsubscribe: string | null;
  precedence: string | null;
  auto_submitted: string | null;
  from_address: string | null;
  to_me: boolean;
  cc_me: boolean;
  dkim_aligned: boolean | null;
  internal_date: Date;
  sender_message_count: number;
  my_reply_count: number;
  now: Date;
};

export type MessageSignals = {
  is_bulk: boolean;
  is_automated: boolean;
  addressed_to_me: boolean;
  cc_me: boolean;
  sender_known: boolean;
  dkim_aligned: boolean | null;
  volume_bucket: VolumeBucket;
  age_days: number;
};

// §5.1 lists these three headers as the bulk markers. Precedence carries several values in the wild and
// only "bulk" and "list" mean automated distribution — "urgent" and "first-class" are ordinary mail.
// Exported so the SQL spelling of this rule in server/mail/query/ compares the same values rather than
// restating the literals; §5.1 never makes Precedence an is_automated marker.
export const BULK_PRECEDENCE_VALUES = ["bulk", "list"] as const;

// §5.1's automated local parts, held as alternation fragments rather than as finished RegExp objects
// because server/mail/query/signal-sql.ts has to spell the same rule as a MySQL REGEXP and cannot read a
// JavaScript regex. `-?` is the only metacharacter used and ICU (MySQL 8.4) and JS read it identically,
// so both halves compile from this one list instead of a second hand-typed copy.
const AUTOMATED_LOCAL_PARTS = ["no-?reply", "mailer-daemon", "postmaster", "do-?not-?reply"] as const;

export const AUTOMATED_LOCAL_PART_PATTERN = `^(${AUTOMATED_LOCAL_PARTS.join("|")})@`;

const automated_local_part_regex = new RegExp(AUTOMATED_LOCAL_PART_PATTERN, "i");

export function isAutomatedAddress(from_address: string | null): boolean {
  return automated_local_part_regex.test(from_address ?? "");
}

export function normalizePrecedence(raw: string | null): string {
  return (raw ?? "").trim().toLowerCase();
}

export function isBulkPrecedence(raw: string | null): boolean {
  const normalized = normalizePrecedence(raw);
  return BULK_PRECEDENCE_VALUES.some((value) => value === normalized);
}

export function volumeBucket(message_count: number): VolumeBucket {
  if (message_count >= 1000) {
    return "flood";
  }
  if (message_count >= 100) {
    return "high";
  }
  if (message_count >= 10) {
    return "medium";
  }
  return "low";
}

export function deriveSignals(input: SignalInput): MessageSignals {
  const is_bulk = input.list_id !== null || input.list_unsubscribe !== null || isBulkPrecedence(input.precedence);
  const is_automated = input.auto_submitted !== null || isAutomatedAddress(input.from_address);
  const elapsed_ms = input.now.getTime() - input.internal_date.getTime();

  return {
    is_bulk,
    is_automated,
    addressed_to_me: input.to_me,
    cc_me: input.cc_me,
    sender_known: input.my_reply_count > 0,
    dkim_aligned: input.dkim_aligned,
    volume_bucket: volumeBucket(input.sender_message_count),
    age_days: Math.max(0, Math.floor(elapsed_ms / 86_400_000)),
  };
}
