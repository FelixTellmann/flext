import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/verify-request")({
  component: VerifyRequestPage,
});

function VerifyRequestPage() {
  return <div>Check your email for a sign-in link.</div>;
}
