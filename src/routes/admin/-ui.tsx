import clsx from "clsx";
import type { FC, ReactNode } from "react";

export const Panel: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="rounded-lg border border-gray-200 bg-card p-4 dark:border-dark-border dark:bg-dark-card">
    <h2 className="mb-3 font-semibold text-gray-900 text-sm dark:text-dark-headings">{title}</h2>
    {children}
  </section>
);

// --color-accent and --color-accent-contrast hold the same RGB, so the token pair renders invisible text.
// Same workaround as the sign-in button until the design-system gap is closed.
export const accent_button = "rounded bg-accent px-3 py-2 font-medium text-sm text-white dark:bg-accent-dark dark:text-dark-bg";
export const field = "rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg";
export const secondary_button = "rounded border border-gray-300 px-3 py-1 text-sm dark:border-dark-border";
export const busy_state = "inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50";

export const Spinner: FC = () => (
  <svg aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
  </svg>
);

// A backfill can hold the request open for minutes, so a button that still looks clickable is the whole
// problem: every action disables the entire set, and the one that is working says so.
export const ActionButton: FC<{
  busy: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  variant: string;
}> = ({ busy, disabled, label, onClick, variant }) => (
  <button className={clsx(variant, busy_state)} disabled={disabled} onClick={onClick} type="button">
    {busy && <Spinner />}
    {busy ? `${label}…` : label}
  </button>
);
