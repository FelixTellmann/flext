import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  // Database (PlanetScale)
  DATABASE_URL: z.string(),
  DATABASE_URL_PROD: z.string(),
  DATABASE_URL_DEV: z.string(),
  PLANETSCALE_SSL_CERT_PATH: z.string(),
  PLANETSCALE_DB_HOST: z.string(),
  PLANETSCALE_DB_PASSWORD: z.string(),
  PLANETSCALE_DB_USERNAME: z.string(),
  PLANETSCALE_DB: z.string(),
  PLANETSCALE_ORG: z.string(),
  PLANETSCALE_TOKEN: z.string(),
  PLANETSCALE_TOKEN_NAME: z.string(),

  // Auth
  JWT_SECRET: z.string(),
  SCRIPT_SECRET: z.string(),

  // OAuth - GitHub
  GITHUB_APP_ID: z.string(),
  GITHUB_ID: z.string(),
  GITHUB_SECRET: z.string(),

  // OAuth - Google
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),

  // OAuth - Twitter
  // Optional while the API access is being re-keyed: the hero profile card is skipped when the
  // fetch fails, so a missing token degrades gracefully rather than failing env validation at boot.
  TWITTER_CLIENT_ID: z.string().optional(),
  TWITTER_CLIENT_SECRET: z.string().optional(),
  TWITTER_CLIENT_BEARER_TOKEN: z.string().optional(),
  TWITTER_CLIENT_ID_2022_08: z.string().optional(),
  TWITTER_CLIENT_SECRET_2022_08: z.string().optional(),

  // OAuth - Facebook
  FACEBOOK_CLIENT_ID: z.string(),
  FACEBOOK_CLIENT_SECRET: z.string(),
  FACEBOOK_CLIENT_PROD_ID: z.string(),
  FACEBOOK_CLIENT_PROD_SECRET: z.string(),

  // Email (magic link)
  EMAIL_SERVER_USER: z.string(),
  EMAIL_SERVER_PASSWORD: z.string(),
  EMAIL_SERVER_HOST: z.string(),
  EMAIL_SERVER_PORT: z.string(),
  EMAIL_FROM: z.string(),

  // Public
  VITE_PUBLIC_APP_VERSION: z.string(),
  VITE_PUBLIC_HOSTNAME: z.string(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", JSON.stringify(parsed.error.format(), null, 4));
  process.exit(1);
}

export const env = parsed.data;
