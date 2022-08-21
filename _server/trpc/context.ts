/* eslint-disable @typescript-eslint/no-unused-vars */
import * as trpc from "@trpc/server";
import * as trpcNext from "@trpc/server/adapters/next";
import { DB } from "_server/trpc/prisma";
import { getSession } from "next-auth/react";

type CreateTrpcContextOptions = {
  // session: Session | null
};

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createTrpcContextInner = async ({ req, res }: trpcNext.CreateNextContextOptions) => {
  const session = await getSession({ req });
  console.log("createContext for", session?.user?.name ?? "unknown user");

  return {
    req,
    res,
    DB,
    session,
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
