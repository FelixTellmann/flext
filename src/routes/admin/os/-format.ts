import { OPERATOR_TIME_ZONE } from "@server/operator-day";

// Formatted in the operator's zone rather than the browser's, so the server render and the hydrated
// one agree and a date the server called today never prints as yesterday. Naming the zone once here
// is the point: the literal was written out again in two screens before this module existed.

export const formatDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: OPERATOR_TIME_ZONE }).format(new Date(iso));

export const formatToday = (): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: OPERATOR_TIME_ZONE, weekday: "long" }).format(new Date());

// A plain date string is already a calendar day, so it is read as UTC rather than shifted again.
export const formatWeekday = (date: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T00:00:00.000Z`));

const minutesOf = (seconds: number): string => String(Math.round((seconds % 3600) / 60)).padStart(2, "0");

/** `35h 50m` — for a total read on its own. */
export const formatLong = (seconds: number): string => `${Math.floor(seconds / 3600)}h ${minutesOf(seconds)}m`;

/** `7h30` — for a label sitting above a bar, where width matters. */
export const formatShort = (seconds: number): string => `${Math.floor(seconds / 3600)}h${minutesOf(seconds)}`;

/** `1:30` — for a table column, where the colon aligns under tabular-nums. */
export const formatColon = (seconds: number): string => `${Math.floor(seconds / 3600)}:${minutesOf(seconds)}`;
