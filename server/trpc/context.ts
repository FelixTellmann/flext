/* eslint-disable @typescript-eslint/no-unused-vars */
import * as trpc from "@trpc/server";
import * as trpcNext from "@trpc/server/adapters/next";
import { Session, unstable_getServerSession } from "next-auth";
import { authOptions } from "pages/api/auth/[...nextauth]";
import { prisma } from "server/trpc/prisma";
import { getSession } from "next-auth/react";

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createTrpcContextInner = async ({
  req = null,
  res = null,
}: trpcNext.CreateNextContextOptions | { req: null; res: null }) => {
  if (req && res) {
    const session = await unstable_getServerSession(req, res, authOptions);
    console.log("createContext for", session?.user?.name ?? "unknown user");
    return {
      req,
      res,
      prisma,
      session,
    };
  }

  return {
    req,
    res,
    prisma,
    session: null,
  };
};

export type Context = trpc.inferAsyncReturnType<typeof createTrpcContextInner>;

/**
 * Creates context for an incoming request
 * @link https://trpc.io/docs/context
 */
export async function trpcContext(opts: trpcNext.CreateNextContextOptions): Promise<Context> {
  // for API-response caching see https://trpc.io/docs/caching

  return await createTrpcContextInner(opts);
}
