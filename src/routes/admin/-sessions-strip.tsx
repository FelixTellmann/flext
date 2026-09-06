import type { FC } from "react";
import {
  describeEvidence,
  describeLatestSession,
  formatMailboxList,
  formatSessionDay,
  formatTimeSpan,
  SESSIONS_COUNTING_SINCE,
  type SessionEvidence,
} from "./-attention-sessions";
import { Panel } from "./-ui";

// The calibration surface for the session threshold (inbox-dwell §3): if this disagrees with the
// operator's memory of when he last checked mail, the threshold is wrong. `loaded_at` is the instant the
// loader ran, so the relative time is the same string on the server render and after hydration.
export const SessionsStrip: FC<{ sessions: SessionEvidence[]; loaded_at: string }> = ({ sessions, loaded_at }) => {
  const [latest, ...previous] = sessions;

  return (
    <Panel title="Triage sessions">
      {latest === undefined && (
        <p className="text-sm text-zinc-600 dark:text-dark-text">
          No triage session recorded yet. Sessions started counting on {SESSIONS_COUNTING_SINCE}.
        </p>
      )}
      {latest !== undefined && (
        <>
          <p className="text-sm text-zinc-900 dark:text-dark-headings">{describeLatestSession(latest, loaded_at)}</p>
          {previous.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {previous.map((session) => (
                <li className="text-xs text-zinc-600 dark:text-dark-text" key={session.ended_at}>
                  {formatSessionDay(session.started_at)} · {formatTimeSpan(session.started_at, session.ended_at)} ·{" "}
                  {describeEvidence(session)} · {formatMailboxList(session.mailbox_labels)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
};
