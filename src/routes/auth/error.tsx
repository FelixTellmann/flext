import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/error")({
  component: AuthErrorPage,
});

function AuthErrorPage() {
  return <div>Auth Error</div>;
}
