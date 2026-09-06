import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { os_screens } from "./-sidebar";

export type PaletteAction = { id: string; label: string; run: () => void };

type PaletteResult = { id: string; kind: string; label: string; run: () => void };

// Navigating and doing share one list on purpose. Splitting them would mean deciding, before you type,
// whether the thing you want is a place or a verb — which is exactly the decision the palette exists to
// spare you.
export const CommandPalette: FC<{ actions: PaletteAction[]; onClose: () => void }> = ({ actions, onClose }) => {
  const navigate = useNavigate();
  const input_ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    input_ref.current?.focus();
  }, []);

  const results: PaletteResult[] = [
    ...os_screens.map((screen) => ({ id: screen.to, kind: "Go", label: screen.label, run: () => navigate({ to: screen.to }) })),
    ...actions.map((action) => ({ id: action.id, kind: "Action", label: action.label, run: action.run })),
  ].filter((result) => result.label.toLowerCase().includes(query.trim().toLowerCase()));

  const runResult = (result: PaletteResult) => {
    result.run();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => (current + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => (current - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      const result = results[selected];

      if (result !== undefined) {
        runResult(result);
      }
    }
  };

  return (
    <>
      {/* The scrim stops at the sidebar: the palette dims what you are leaving, not the map you are
          navigating by. It is a button rather than a div so dismissing it survives without a mouse. */}
      <button
        aria-label="Close the command palette"
        className="absolute inset-0 bg-gray-900/[0.18] dark:bg-black/45"
        onClick={() => onClose()}
        type="button"
      />
      <div className="absolute top-[150px] left-1/2 w-[560px] -translate-x-1/2 overflow-hidden rounded-lg border border-gray-300 bg-bg shadow-2xl dark:border-dark-border dark:bg-dark-bg">
        <div className="flex items-center gap-2.5 border-gray-200 border-b px-4 py-3.5 dark:border-dark-border">
          <MagnifyingGlassIcon className="h-4 w-4 text-gray-500 dark:text-dark-text" />
          <input
            className="flex-grow bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-dark-headings dark:placeholder:text-dark-text"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a screen, or run something"
            ref={input_ref}
            value={query}
          />
          <button
            className="rounded-sm border border-gray-200 px-1.5 text-[11px] text-gray-500 dark:border-dark-border dark:text-dark-text"
            onClick={() => onClose()}
            type="button"
          >
            Esc
          </button>
        </div>

        <div className="flex min-h-[60px] flex-col p-1.5">
          {results.map((result, index) => (
            <button
              className={clsx(
                "flex items-center gap-2.5 rounded px-3 py-2.5 text-left text-sm",
                index === selected
                  ? "bg-card text-gray-900 dark:bg-dark-card dark:text-dark-headings"
                  : "text-gray-600 dark:text-dark-text",
              )}
              key={result.id}
              onClick={() => runResult(result)}
              onMouseEnter={() => setSelected(index)}
              type="button"
            >
              <span className="flex-grow">{result.label}</span>
              <span className="text-gray-500 text-xs dark:text-dark-text">{result.kind}</span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-3 py-3.5 text-gray-500 text-sm dark:text-dark-text">Nothing matches &ldquo;{query}&rdquo;.</p>
          )}
        </div>

        <div className="border-gray-200 border-t px-4 py-2 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
          Enter to run &middot; Esc to close
        </div>
      </div>
    </>
  );
};
