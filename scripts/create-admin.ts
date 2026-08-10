import { signUp } from "@server/auth/credentials";
import { db } from "@server/db/drizzle";
import { user } from "@server/db/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { isValidPassword } from "utils/validate-password";

// One-off operator bootstrap: /auth/sign-up is disabled by design, so the first
// (and only) admin row has to be created out of band. Sign-in additionally
// requires the email to match ADMIN_EMAIL — server/auth/session.ts re-checks it
// on every request, so a mismatch would invalidate sessions, not just sign-in.
//
//   bun scripts/create-admin.ts "Felix Tellmann" you@example.com "password"

const [name, email, password] = process.argv.slice(2);

if (!name || !email || !password) {
  console.error('usage: bun scripts/create-admin.ts "<name>" <email> "<password>"');
  process.exit(1);
}

const admin_email = process.env.ADMIN_EMAIL;

if (!admin_email) {
  console.error("ADMIN_EMAIL is not set — refusing to create a user that could never sign in.");
  process.exit(1);
}

if (admin_email.toLowerCase() !== email.toLowerCase()) {
  console.error(`email must match ADMIN_EMAIL (${admin_email}) or sign-in will always fail.`);
  process.exit(1);
}

if (!isValidPassword(password)) {
  console.error("password must be 8+ chars with an uppercase, lowercase, digit, symbol, and no whitespace.");
  process.exit(1);
}

const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
const existing_user = existing[0];

// The restored PlanetScale dump carries OAuth-era rows whose password is NULL;
// signUp() rejects those as account-exists, so set the hash on the row instead.
if (existing_user) {
  await db
    .update(user)
    .set({ password: await bcrypt.hash(password, 10), name })
    .where(eq(user.id, existing_user.id));

  console.log(`password set on existing user: ${email}`);
  process.exit(0);
}

const result = await signUp({ name, email, password });

if (!result.success) {
  console.error("failed:", result.error);
  process.exit(1);
}

console.log(`created: ${result.user.email}`);
process.exit(0);
