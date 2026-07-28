import { z } from "zod";

const server_env_schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_CA_PATH: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  MAIL_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)"),
  ADMIN_EMAIL: z.string().email(),
});

export type ServerEnv = z.infer<typeof server_env_schema>;

let cached: ServerEnv | null = null;

// Validation is lazy so this module stays safe to import from anything that might
// end up in a client bundle: the throw can only fire on first read, which never
// happens in the browser. The root env.ts calls process.exit(1) at import time,
// which is why it cannot be used here.
export function serverEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = server_env_schema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${JSON.stringify(parsed.error.format(), null, 2)}`);
  }

  cached = parsed.data;
  return cached;
}
