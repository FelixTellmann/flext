// What counts as "today" for this system, in one place. The container runs UTC and the operator does not,
// so a UTC day would begin at 02:00 local and quietly file the small hours as yesterday — every screen,
// every bucket and every ingest window has to agree on the same boundary or they misreport each other's
// numbers. South Africa observes no daylight saving, so a fixed offset is correct year-round and spares
// this a date library.
export const OPERATOR_UTC_OFFSET_MINUTES = 120;
export const OPERATOR_TIME_ZONE = "Africa/Johannesburg";
export const DAY_MS = 24 * 60 * 60 * 1000;

const shiftToOperator = (at: Date): Date => new Date(at.getTime() + OPERATOR_UTC_OFFSET_MINUTES * 60_000);

// The UTC instant at which the operator's day containing `at` began.
export const operatorDayStart = (at: Date = new Date()): Date => {
  const shifted = shiftToOperator(at);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - OPERATOR_UTC_OFFSET_MINUTES * 60_000);
};

// The UTC instant at which a named operator day began: 2026-08-28 in Johannesburg starts 2026-08-27T22:00Z.
export const operatorDayStartOf = (date: string): Date =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() - OPERATOR_UTC_OFFSET_MINUTES * 60_000);

// The operator's calendar date for an instant, as YYYY-MM-DD.
export const operatorDateOf = (at: Date = new Date()): string => shiftToOperator(at).toISOString().slice(0, 10);

export const isoWeekOf = (at: Date = new Date()): string => {
  const shifted = shiftToOperator(at);
  shifted.setUTCHours(0, 0, 0, 0);
  // ISO 8601 pins a week to the year containing its Thursday, which is why the year cannot simply be read
  // off the date: 2026-12-31 can belong to week 1 of 2027.
  shifted.setUTCDate(shifted.getUTCDate() + 4 - (shifted.getUTCDay() || 7));
  const year = shifted.getUTCFullYear();
  const first_thursday = Date.UTC(year, 0, 1);
  const week = Math.ceil(((shifted.getTime() - first_thursday) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

// Monday to Sunday of the operator's week containing `at`, as YYYY-MM-DD. ISO weeks start Monday,
// and getUTCDay() calls Sunday 0 — hence the shift, which is the bug this exists to only write once.
export const operatorWeekRange = (at: Date = new Date()): { from: string; to: string } => {
  const shifted = new Date(at.getTime() + OPERATOR_UTC_OFFSET_MINUTES * 60_000);
  const monday = new Date(shifted.getTime() - ((shifted.getUTCDay() + 6) % 7) * DAY_MS);

  return { from: monday.toISOString().slice(0, 10), to: new Date(monday.getTime() + 6 * DAY_MS).toISOString().slice(0, 10) };
};
