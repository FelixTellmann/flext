import { PrismaAdapter } from "@next-auth/prisma-adapter";

import { env } from "server/trpc/env";
import { prisma } from "server/trpc/prisma";
import bcrypt from "bcrypt";
import cuid from "cuid";
import NextAuth, { Account, NextAuthOptions, User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import FacebookProvider from "next-auth/providers/facebook";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import TwitterProvider from "next-auth/providers/twitter";
import { isValidPassword } from "utils/validate-password";
import validate from "validator";

export const authOptions: NextAuthOptions = {
  // Configure one or more authentication providers
  adapter: PrismaAdapter(prisma),
  secret: env.NEXTAUTH_SECRET,
  session: {
    maxAge: 120 * 24 * 60 * 60, // 120 days
    strategy: "jwt",
  },
  debug: false,
  pages: {
    signIn: "/auth/sign-in",
    signOut: "/auth/sign-out",
    error: "/auth/error", // Error code passed in query string as ?error=
    verifyRequest: "/auth/verify-request", // (used for check email message)
  },
  providers: [
    GithubProvider({
      clientId: env.GITHUB_ID,
      clientSecret: env.GITHUB_SECRET,
    }),
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
    TwitterProvider({
      clientId: env.TWITTER_CLIENT_ID,
      clientSecret: env.TWITTER_CLIENT_SECRET,
      // version: "2.0", // opt-in to Twitter OAuth 2.0
    }),
    FacebookProvider({
      clientId: env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
    }),
    EmailProvider({
      server: {
        host: env.EMAIL_SERVER_HOST,
        port: env.EMAIL_SERVER_PORT,
        auth: {
          user: env.EMAIL_SERVER_USER,
          pass: env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: env.EMAIL_FROM,
      maxAge: 24 * 60 * 60,
      // sendVerificationRequest: async ({ identifier: email, url, provider: { server, from } }) => {
      //   console.log({
      //     identifier: email,
      //     url,
      //     provider: { server, from },
      //   });
      // },
    }),
    CredentialsProvider({
      id: "sign-up",
      // The name to display on the sign in form (e.g. "Sign in with...")
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        name: { label: "Name", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        marketing: { label: "Accepts Marketing", type: "checkbox" },
      },
      // @ts-ignore
      authorize: async (credentials, req) => {
        if (!credentials) {
          return {
            incorrectPassword: true,
          };
        }
        /*= =============== Validate Data  ================ */
        if (
          !isValidPassword(credentials.password) ||
          !validate.isEmail(credentials.email) ||
          validate.isEmpty(credentials.name)
        ) {
          return {
            validationError: true,
          };
        }

        try {
          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email,
            },
            include: {
              accounts: true,
            },
          });

          if (!user) {
            const hash = await bcrypt.hash(credentials.password, 0);

            return await prisma.user.create({
              data: {
                id: cuid(),
                name: credentials.name,
                email: credentials.email,
                emailVerified: null,
                password: hash,
                image: null,
                acceptMarketing: !!credentials.marketing,
              },
            });
          }

          if (!user.password) {
            return {
              ...user,
              accountExists: true,
            };
          }

          const isValidPassword = await bcrypt.compare(credentials.password, user.password);

          if (isValidPassword) {
            return user;
          }

          return {
            incorrectPassword: true,
          };
        } catch (err) {
          console.log("Authorize error:", err);
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: "sign-in",
      // The name to display on the sign in form (e.g. "Sign in with...")
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // @ts-ignore
      authorize: async (credentials, req) => {
        /*= =============== Validate Data  ================ */
        if (!credentials) {
          return {
            incorrectPassword: true,
          };
        }
        if (!isValidPassword(credentials.password) || !validate.isEmail(credentials.email)) {
          return {
            validationError: true,
          };
        }

        try {
          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email,
            },
            include: {
              accounts: true,
            },
          });

          if (!user) {
            return {
              accountNotFound: true,
            };
          }

          if (!user.password) {
            return {
              ...user,
              accountExists: true,
            };
          }

          const isValidPassword = await bcrypt.compare(credentials.password, user.password);

          if (isValidPassword) {
            return user;
          }
          console.log("Hash not matched");

          return {
            incorrectPassword: true,
          };
        } catch (err) {
          console.log("Authorize error:", err);
          return null;
        }
      },
    }),

    // ...add more providers here
  ],

  callbacks: {
    signIn: async ({ user: untypedUser, account, profile, email, credentials }) => {
      const user = untypedUser as User & {
        accounts: Account[];
        validationError: any;
        accountExists?: any;
        accountNotFound?: any;
        incorrectPassword?: any;
        emailVerified?: any;
      };
      if (credentials) {
        if (user.validationError) {
          return "http://localhost:3000/auth/error?error=validation-error";
        }

        if (user.accountExists) {
          return `http://localhost:3000/auth/error?error=account-exists|||${user?.accounts
            .map((acc) => acc.provider)
            .join(",")}`;
        }

        if (user.accountNotFound) {
          return `http://localhost:3000/auth/error?error=account-not-found`;
        }

        if (user.incorrectPassword) {
          return `http://localhost:3000/auth/error?error=incorrect-password`;
        }

        if (!user?.emailVerified) {
          return "http://localhost:3000/auth/error?error=email-not-verified";
        }
      }

      /* if (email && "email" in email) {
        return "http://localhost:3000/auth/login?session=fetch";
      }*/

      if (account && user && user.email) {
        const fullUser = await prisma.user.findUnique({
          where: {
            email: user.email,
          },
          include: {
            accounts: true,
          },
        });
        if (fullUser?.accounts.some((acc) => acc.providerAccountId === account.providerAccountId)) {
          return true;
        }
        if (fullUser?.accounts.length) {
          return `http://localhost:3000/auth/error?error=account-exists|||${fullUser?.accounts
            // @ts-ignore
            ?.map((acc) => acc.provider)
            .join(",")}`;
        }
      }

      return true;
      /* if (user && user.emailVerified) {
        return true;
      }

      return false;*/
    },
    session: async ({ session, token, user }) => {
      // Send properties to the client, like an access_token from a provider.
      console.log("next-auth Callback: session");
      // console.log({ session, token, user });
      console.log(session);
      return session;
    },
    redirect: async ({ url, baseUrl }) => {
      // console.log({ url, baseUrl });
      console.log("next-auth Callback: redirect");
      return url;
    },
    jwt: async ({ token, user, account, profile, isNewUser }) => {
      // Persist the OAuth access_token to the token right after signin
      console.log("next-auth Callback: jwt");

      // console.log({ token, user, account, profile, isNewUser });
      return token;
    },
    /*session: async ({ session, token, user }) => {
      // Send properties to the client, like an access_token from a provider.
      return session;
    },
    jwt: async ({ token, account }) => {
      // Persist the OAuth access_token to the token right after signin
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },*/
  },
};
export default NextAuth(authOptions);
