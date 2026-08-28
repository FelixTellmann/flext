import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { OutcomeBanner } from "../-outcome-banner";
import { toFailureBanner } from "../-outcome-banner";

// Every mutation on these screens has the same shape: mark what is working, clear the last complaint,
// run it, refetch, and say so if it failed. `key` is whatever the screen disables on — usually a task id,
// but any string will do for an action that has no row of its own.
export const useTaskAction = () => {
  const router = useRouter();
  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [busy_key, setBusyKey] = useState<string | null>(null);

  const run = async (key: string, prefix: string, work: () => Promise<void>) => {
    setBusyKey(key);
    setBanner(null);
    try {
      await work();
    } catch (error) {
      setBanner(toFailureBanner(prefix, error));
    } finally {
      // Refetched even after a failure. A rejected reorder or a half-applied state change would otherwise
      // leave the screen showing an optimistic result the server never accepted.
      await router.invalidate();
      setBusyKey(null);
    }
  };

  return { banner, busy_key, run, setBanner };
};
