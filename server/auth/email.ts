import { db } from "@server/db/drizzle";
import { verificationToken } from "@server/db/schema";
import { and, eq } from "drizzle-orm";
import { createTransport } from "nodemailer";

function getTransport() {
  return createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT),
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  });
}

export async function sendMagicLink(email: string, baseUrl: string): Promise<void> {
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.insert(verificationToken).values({
    identifier: email,
    token,
    expires,
  });

  const url = `${baseUrl}/auth/callback/email?token=${token}&email=${encodeURIComponent(email)}`;

  await getTransport().sendMail({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: "Sign in to flext.dev",
    text: `Sign in to flext.dev\n\n${url}\n\n`,
    html: `<p>Sign in to flext.dev</p><p><a href="${url}">Click here to sign in</a></p>`,
  });
}

export async function verifyMagicLinkToken(email: string, token: string): Promise<boolean> {
  const records = await db
    .select()
    .from(verificationToken)
    .where(and(eq(verificationToken.identifier, email), eq(verificationToken.token, token)))
    .limit(1);

  if (records.length === 0) return false;

  const record = records[0]!;
  if (new Date() > record.expires) return false;

  await db.delete(verificationToken).where(and(eq(verificationToken.identifier, email), eq(verificationToken.token, token)));

  return true;
}
