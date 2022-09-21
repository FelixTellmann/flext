// @ts-check

/**
 * This file is included in `/next.config.js` which ensures the app isn't built with invalid env vars.
 * It has to be a `.js`-file to be imported there.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { z } = require("zod");

const envSchema = z.object({
  // DATABASE_URL: z.string().url(),
  SCRIPT_SECRET: z.string(),
  PLANETSCALE_SSL_CERT_PATH: z.string(),
  PLANETSCALE_DB_HOST: z.string(),
  PLANETSCALE_DB_PASSWORD: z.string(),
  PLANETSCALE_DB_USERNAME: z.string(),
  PLANETSCALE_DB: z.string(),
  PLANETSCALE_ORG: z.string(),
  PLANETSCALE_TOKEN: z.string(),
  PLANETSCALE_TOKEN_NAME: z.string(),
  DATABASE_URL: z.string(),
  DATABASE_URL_PROD: z.string(),
  DATABASE_URL_DEV: z.string(),
  EMAIL_SERVER_USER: z.string(),
  EMAIL_SERVER_PASSWORD: z.string(),
  EMAIL_SERVER_HOST: z.string(),
  EMAIL_SERVER_PORT: z.string(),
  EMAIL_FROM: z.string(),
  NEXTAUTH_URL: z.string(),
  NEXTAUTH_SECRET: z.string(),
  GITHUB_APP_ID: z.string(),
  GITHUB_ID: z.string(),
  GITHUB_SECRET: z.string(),
  TWITTER_CLIENT_ID: z.string(),
  TWITTER_CLIENT_BEARER_TOKEN: z.string(),
  TWITTER_CLIENT_ID_2022_08: z.string(),
  TWITTER_CLIENT_SECRET: z.string(),
  TWITTER_CLIENT_SECRET_2022_08: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  FACEBOOK_CLIENT_ID: z.string(),
  FACEBOOK_CLIENT_SECRET: z.string(),
  FACEBOOK_CLIENT_PROD_ID: z.string(),
  FACEBOOK_CLIENT_PROD_SECRET: z.string(),
  NEXT_PUBLIC_APP_VERSION: z.string(),
  NEXT_PUBLIC_HOSTNAME: z.string(),
  NODE_ENV: z.enum(["development", "test", "production"]),
});

const env = envSchema.safeParse(process.env);

if (!env.success) {
  console.error("❌ Invalid environment variables:", JSON.stringify(env.error?.format(), null, 4));
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}
module.exports.env = env.data;
