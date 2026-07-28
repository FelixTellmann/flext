import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/sign-up")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/sign-in" });
  },
});
