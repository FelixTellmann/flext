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
const BULK_PRECEDENCE = new Set(["bulk", "list"]);
const AUTOMATED_LOCAL_PARTS = [/^no-?reply@/i, /^mailer-daemon@/i, /^postmaster@/i, /^do-?not-?reply@/i];

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
  const precedence = (input.precedence ?? "").trim().toLowerCase();
  const is_bulk = input.list_id !== null || input.list_unsubscribe !== null || BULK_PRECEDENCE.has(precedence);
  const from_address = input.from_address ?? "";
  const is_automated = input.auto_submitted !== null || AUTOMATED_LOCAL_PARTS.some((pattern) => pattern.test(from_address));
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
