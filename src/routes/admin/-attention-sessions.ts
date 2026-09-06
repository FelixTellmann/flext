import { OPERATOR_TIME_ZONE } from "@server/operator-day";

// Pure formatting for the Sessions strip. Kept out of the component so it can be checked from fixtures,
// and every "now" is passed in rather than read from the clock: the loader stamps one instant that the
// server render and the hydrated one both format, so "3 hours ago" never differs between them.

export type SessionEvidence = {
  started_at: string;
  ended_at: string;
  seen_transitions: number;
  flag_changes: number;
  replies_sent: number;
  mailbox_labels: string[];
};

export const SESSIONS_COUNTING_SINCE = "2026-09-06";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`;
}

export function formatRelative(iso: string, now: string): string {
  const elapsed = new Date(now).getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${plural(Math.floor(elapsed / MINUTE_MS), "minute", "minutes")} ago`;
  }
  if (elapsed < DAY_MS) {
    return `${plural(Math.floor(elapsed / HOUR_MS), "hour", "hours")} ago`;
  }
  return `${plural(Math.floor(elapsed / DAY_MS), "day", "days")} ago`;
}

// A session opened by a single sync run starts and ends on the same instant; "0 min" would read as a
// broken clock when it means one fifteen-minute window held all the evidence.
export function formatDuration(started_at: string, ended_at: string): string {
  const minutes = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / MINUTE_MS);
  if (minutes < 1) {
    return "a single check";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function describeEvidence(session: SessionEvidence): string {
  return [
    plural(session.seen_transitions, "read", "reads"),
    plural(session.flag_changes, "flag change", "flag changes"),
    plural(session.replies_sent, "reply", "replies"),
  ].join(", ");
}

export function formatMailboxList(labels: string[]): string {
  if (labels.length === 0) {
    return "no mailbox recorded";
  }
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function describeLatestSession(session: SessionEvidence, now: string): string {
  const when = formatRelative(session.ended_at, now);
  const length = formatDuration(session.started_at, session.ended_at);
  return `Last believed reading mail: ${when} for ${length}, ${describeEvidence(session)}, in ${formatMailboxList(session.mailbox_labels)}`;
}

export const formatSessionDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: OPERATOR_TIME_ZONE }).format(
    new Date(iso),
  );

const time_of_day = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: OPERATOR_TIME_ZONE,
});

export function formatTimeSpan(started_at: string, ended_at: string): string {
  const start = time_of_day.format(new Date(started_at));
  const end = time_of_day.format(new Date(ended_at));
  return start === end ? start : `${start}–${end}`;
}
