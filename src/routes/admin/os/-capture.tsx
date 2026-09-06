import { useRouter } from "@tanstack/react-router";
import { type FC, type FormEvent, useEffect, useRef, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { makeStore } from "~/stores/_make-store";
import type { OutcomeBanner } from "../-outcome-banner";
import { Banner, toFailureBanner } from "../-outcome-banner";
import { Spinner } from "../-ui";

// Whether the overlay is open is shared across the whole shell — the sidebar's key, the palette and
// Today's header button all open the same one — so it goes through the store factory rather than being
// threaded down as props. The provider is mounted by the /admin/os layout, not app-wide.
export const { Provider: CaptureProvider, useStore: useCaptureStore } = makeStore(false, "PersonalOsCaptureStore");

// One field, no area, no project, no date. Triage happens in the morning recap and the Sunday review; a
// required field here is the thing that stops a thought being written down at all.
export const CaptureOverlay: FC = () => {
  const [, setOpen] = useCaptureStore();
  const router = useRouter();
  const input_ref = useRef<HTMLInputElement>(null);

  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [saved_count, setSavedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    input_ref.current?.focus();
  }, []);

  const close = () => {
    setOpen(false);
  };

  // The overlay stays open after a save so a run of thoughts costs one keystroke, not one round trip
  // each. Closing on success would make the second thought as expensive as the first.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();

    if (trimmed === "" || saving) {
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      await orpc.personalTasks.capture({ title: trimmed });
      setSavedCount((count) => count + 1);
      setTitle("");
      await router.invalidate();
    } catch (error) {
      setBanner(toFailureBanner("Could not capture that", error));
    } finally {
      setSaving(false);
      input_ref.current?.focus();
    }
  };

  return (
    <>
      <button
        aria-label="Close capture"
        className="absolute inset-0 bg-gray-900/[0.18] dark:bg-black/45"
        onClick={() => close()}
        type="button"
      />
      <div className="absolute top-[150px] left-1/2 w-[560px] -translate-x-1/2 overflow-hidden rounded-lg border border-gray-300 bg-bg shadow-2xl dark:border-dark-border dark:bg-dark-bg">
        <form className="flex flex-col gap-3 p-4" onSubmit={submit}>
          <div className="flex gap-2.5">
            <input
              className="flex-grow rounded border border-gray-300 bg-bg px-3 py-2.5 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings dark:placeholder:text-dark-text"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  close();
                }
              }}
              placeholder="type anything&hellip;"
              ref={input_ref}
              value={title}
            />
            <button
              className="inline-flex items-center justify-center gap-2 rounded bg-accent px-4 font-medium text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent-dark dark:text-dark-bg"
              disabled={saving || title.trim() === ""}
              type="submit"
            >
              {saving && <Spinner />}
              Save
            </button>
          </div>

          {banner !== null && <Banner banner={banner} className="" />}

          <p className="text-[13px] text-gray-600 dark:text-dark-text">
            {saved_count === 0
              ? "No area, no project, no date. The inbox's only job is that a thought never has to be held in the head."
              : `Captured ${saved_count} — keep going, or press Esc to close.`}
          </p>
        </form>
      </div>
    </>
  );
};
