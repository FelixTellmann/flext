import { db } from "@server/db/drizzle";
import { account, user } from "@server/db/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { isValidPassword } from "utils/validate-password";
import validate from "validator";

type CredentialsResult =
  | { success: true; user: { id: string; email: string; name: string; image: string | null; emailVerified: Date | null } }
  | {
      success: false;
      error: "validation-error" | "account-exists" | "account-not-found" | "incorrect-password" | "email-not-verified";
      providers?: string[];
    };

export async function signUp(input: { name: string; email: string; password: string; marketing?: boolean }): Promise<CredentialsResult> {
  if (!isValidPassword(input.password) || !validate.isEmail(input.email) || validate.isEmpty(input.name)) {
    return { success: false, error: "validation-error" };
  }

  const existing = await db.select().from(user).where(eq(user.email, input.email)).limit(1);

  if (existing.length > 0) {
    const existingUser = existing[0]!;
    if (!existingUser.password) {
      const accounts = await db.select().from(account).where(eq(account.userId, existingUser.id));
      return { success: false, error: "account-exists", providers: accounts.map((a) => a.provider) };
    }
    return { success: false, error: "account-exists" };
  }

  const hash = await bcrypt.hash(input.password, 10);
  const id = crypto.randomUUID();

  await db.insert(user).values({
    id,
    name: input.name,
    email: input.email,
    password: hash,
    acceptMarketing: !!input.marketing,
  });

  return {
    success: true,
    user: { id, email: input.email, name: input.name, image: null, emailVerified: null },
  };
}

export async function signIn(input: { email: string; password: string }): Promise<CredentialsResult> {
  if (!isValidPassword(input.password) || !validate.isEmail(input.email)) {
    return { success: false, error: "validation-error" };
  }

  const existing = await db.select().from(user).where(eq(user.email, input.email)).limit(1);

  if (existing.length === 0) {
    return { success: false, error: "account-not-found" };
  }

  const existingUser = existing[0]!;

  if (!existingUser.password) {
    const accounts = await db.select().from(account).where(eq(account.userId, existingUser.id));
    return { success: false, error: "account-exists", providers: accounts.map((a) => a.provider) };
  }

  const valid = await bcrypt.compare(input.password, existingUser.password);
  if (!valid) {
    return { success: false, error: "incorrect-password" };
  }

  return {
    success: true,
    user: {
      id: existingUser.id,
      email: existingUser.email!,
      name: existingUser.name!,
      image: existingUser.image,
      emailVerified: existingUser.emailVerified,
    },
  };
}
