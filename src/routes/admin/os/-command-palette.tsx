import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useNavigate, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { toFailureBanner } from "../-outcome-banner";
import { os_screens } from "./-sidebar";

export type PaletteAction = { id: string; label: string; run: () => void };

type FoundTask = Awaited<ReturnType<typeof orpc.personalTasks.searchTasks>>[number];

type PaletteResult = { id: string; kind: string; label: string; run: () => void; revive?: () => Promise<void> };

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 150;

// Navigating and doing share one list on purpose. Splitting them would mean deciding, before you type,
// whether the thing you want is a place or a verb — which is exactly the decision the palette exists to
// spare you. Tasks join the same list once there is enough typed to search on, because a someday item
// is only "searchable and revivable" if the search is where the fingers already are.
export const CommandPalette: FC<{ actions: PaletteAction[]; onClose: () => void }> = ({ actions, onClose }) => {
  const navigate = useNavigate();
  const router = useRouter();
  const input_ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [tasks, setTasks] = useState<FoundTask[]>([]);
  const [searching, setSearching] = useState(false);
  const [search_failure, setSearchFailure] = useState<string | null>(null);

  useEffect(() => {
    input_ref.current?.focus();
  }, []);

  const trimmed_query = query.trim();

  // Debounced, and a response that arrives after the query moved on is dropped rather than shown against
  // the wrong text.
  useEffect(() => {
    if (trimmed_query.length < SEARCH_MIN_LENGTH) {
      setTasks([]);
      setSearching(false);
      setSearchFailure(null);
      return;
    }

    let stale = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const found = await orpc.personalTasks.searchTasks({ query: trimmed_query });

        if (!stale) {
          setTasks(found);
          setSearchFailure(null);
        }
      } catch (error) {
        if (!stale) {
          setTasks([]);
          setSearchFailure(toFailureBanner("Could not search tasks", error).text);
        }
      } finally {
        if (!stale) {
          setSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed_query]);

  const results: PaletteResult[] = [
    ...os_screens.map((screen) => ({ id: screen.to, kind: "Go", label: screen.label, run: () => navigate({ to: screen.to }) })),
    ...actions.map((action) => ({ id: action.id, kind: "Action", label: action.label, run: action.run })),
  ]
    .filter((result) => result.label.toLowerCase().includes(trimmed_query.toLowerCase()))
    .concat(
      tasks.map((task) => ({
        id: task.id,
        kind: task.state,
        label: task.title,
        run: () => navigate({ params: { taskId: task.id }, to: "/admin/os/task/$taskId" }),
        ...(task.state === "someday"
          ? {
              revive: async () => {
                await orpc.personalTasks.revive({ id: task.id });
                await router.invalidate();
              },
            }
          : {}),
      })),
    );

  const runResult = (result: PaletteResult) => {
    result.run();
    onClose();
  };

  const reviveResult = async (result: PaletteResult) => {
    if (result.revive === undefined) {
      return;
    }

    try {
      await result.revive();
      onClose();
    } catch (error) {
      setSearchFailure(toFailureBanner("Could not revive the task", error).text);
    }
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
            placeholder="Jump to a screen, run something, or find a task"
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
          {/* A row is a div holding the result button and, for a someday task, a sibling Revive: a button
              cannot sit inside a button. */}
          {results.map((result, index) => (
            <div
              className={clsx(
                "flex items-center gap-2.5 rounded",
                index === selected
                  ? "bg-card text-gray-900 dark:bg-dark-card dark:text-dark-headings"
                  : "text-gray-600 dark:text-dark-text",
              )}
              key={result.id}
            >
              <button
                className="flex min-w-0 flex-grow items-center gap-2.5 px-3 py-2.5 text-left text-sm"
                onClick={() => runResult(result)}
                onMouseEnter={() => setSelected(index)}
                type="button"
              >
                <span className="min-w-0 flex-grow truncate">{result.label}</span>
                <span className="text-gray-500 text-xs dark:text-dark-text">{result.kind}</span>
              </button>
              {result.revive !== undefined && (
                <button
                  className="mr-2 rounded border border-gray-300 px-2 py-0.5 text-gray-600 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:text-dark-text"
                  onClick={() => void reviveResult(result)}
                  type="button"
                >
                  Revive
                </button>
              )}
            </div>
          ))}
          {results.length === 0 && searching && <p className="px-3 py-3.5 text-gray-500 text-sm dark:text-dark-text">Searching&hellip;</p>}
          {results.length === 0 && !searching && (
            <p className="px-3 py-3.5 text-gray-500 text-sm dark:text-dark-text">Nothing matches &ldquo;{query}&rdquo;.</p>
          )}
          {search_failure !== null && <p className="px-3 py-1.5 text-danger text-xs">{search_failure}</p>}
        </div>

        <div className="border-gray-200 border-t px-4 py-2 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
          Enter to open &middot; Esc to close
        </div>
      </div>
    </>
  );
};
