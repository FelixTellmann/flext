// The numbers nobody can justify yet, kept together so changing one is a one-line edit rather than
// an argument. Each is a guess with a rationale, not a finding.
//
// Each is the fallback for a PersonalSetting row of the same name in snake_case, read through
// server/personal-settings.ts. The row is what changes without a deploy; the constant is what applies
// when the row is missing or unreadable.

// Three strikes and a task stops moving, owing a disposition. Amazing Marvin's Procrastination
// Count is the only mainstream implementation and it turns red at three, which is the whole of the
// evidence for this number.
export const DEFERRAL_LIMIT = 3;

// A month in the pool without ever being pulled is decent evidence the task was not for this
// season. Ageing is silent by design (§16 rule 4) — items move to someday searchable and revivable,
// never as a badge — so the cost of this being slightly wrong is low in both directions.
export const SOMEDAY_AGE_DAYS = 30;

// The 12 Week Year's own number for a good week's execution score (spec 4.3). A percentage against it,
// never a streak: 40% is a bad week that reads as 40%, with no line to have crossed.
export const EXECUTION_BENCHMARK = 85;
