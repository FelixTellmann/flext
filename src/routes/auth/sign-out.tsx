import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/sign-out")({
  component: SignOutPage,
});

function SignOutPage() {
  return <div>Signed Out</div>;
}
