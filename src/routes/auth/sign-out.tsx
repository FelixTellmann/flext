import { endSession } from "@server/auth/session";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const submitSignOut = createServerFn({ method: "POST" }).handler(async () => {
  endSession();
  return { ok: true as const };
});

export const Route = createFileRoute("/auth/sign-out")({
  beforeLoad: async () => {
    await submitSignOut();
    throw redirect({ to: "/auth/sign-in" });
  },
});
