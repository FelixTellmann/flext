import { signIn } from "@server/auth/credentials";
import { startSession } from "@server/auth/session";
import { serverEnv } from "@server/env";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type FC, useState } from "react";

const submitSignIn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(async ({ data }) => {
    const result = await signIn(data);
    const is_admin = data.email.toLowerCase() === serverEnv().ADMIN_EMAIL.toLowerCase();

    if (!is_admin || !result.success) {
      return { ok: false as const, message: "Invalid email or password." };
    }

    await startSession({
      user_id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image ?? undefined,
      provider: "credentials",
      email_verified: result.user.emailVerified !== null,
    });

    return { ok: true as const };
  });

const SignInPage: FC = () => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="font-semibold text-2xl text-zinc-800 dark:text-dark-headings">Sign in</h1>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);

          const form = new FormData(event.currentTarget);
          const response = await submitSignIn({
            data: { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") },
          });

          setPending(false);

          if (!response.ok) {
            setError(response.message);
            return;
          }

          await router.navigate({ to: "/admin" });
        }}
      >
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="Email"
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-dark-border dark:bg-dark-card"
        />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-dark-border dark:bg-dark-card"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60 dark:bg-accent-dark dark:text-dark-bg"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </form>
    </div>
  );
};

export const Route = createFileRoute("/auth/sign-in")({
  component: SignInPage,
});
