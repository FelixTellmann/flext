import { loggerLink } from "@trpc/client";
import { httpBatchLink } from "@trpc/client/links/httpBatchLink";
import { setupTRPC } from "@trpc/next";
import { inferProcedureInput, inferProcedureOutput } from "@trpc/server";
import { TrpcRouter } from "_server/api-routes";
import { NextPageContext } from "next";
import superjson from "superjson";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return "";
  }

  if (process.env.NODE_ENV === "development") {
    return `http://localhost:${process.env.PORT ?? 3000}`;
  }
  // reference for vercel.com
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // // reference for render.com
  if (process.env.RENDER_INTERNAL_HOSTNAME) {
    return `http://${process.env.RENDER_INTERNAL_HOSTNAME}:${process.env.PORT}`;
  }

  // assume localhost
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Extend `NextPageContext` with meta data that can be picked up by `responseMeta()` when server-side rendering
 */
export interface SSRContext extends NextPageContext {
  /**
   * Set HTTP Status code
   * @example
   * const utils = trpc.useContext();
   * if (utils.ssrContext) {
   *   utils.ssrContext.status = 404;
   * }
   */
  status?: number;
}

export const trpc = setupTRPC<TrpcRouter, SSRContext>({
  config() {
    return {
      transformer: superjson,
      links: [
        // adds pretty logs to your console in development and logs errors in production
        /*loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),*/

        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
      queryClientConfig: { defaultOptions: { queries: { staleTime: 60 } } },
    };
  },
  // ssr: true,
  responseMeta(opts) {
    const ctx = opts.ctx as SSRContext;

    if (ctx.status) {
      return {
        status: ctx.status,
      };
    }

    const error = opts.clientErrors[0];
    console.log(error);
    if (error) {
      return {
        // @ts-ignore
        status: error.data?.httpStatus ?? 500,
      };
    }

    return {};
  },
});

/**
 * This is a helper method to infer the output of a query resolver
 * @example type HelloOutput = inferQueryOutput<'hello'>
 */
export type inferQueryOutput<TRouteKey extends keyof TrpcRouter["_def"]["queries"]> =
  inferProcedureOutput<TrpcRouter["_def"]["queries"][TRouteKey]>;

export type inferQueryInput<TRouteKey extends keyof TrpcRouter["_def"]["queries"]> =
  inferProcedureInput<TrpcRouter["_def"]["queries"][TRouteKey]>;

export type inferMutationOutput<TRouteKey extends keyof TrpcRouter["_def"]["mutations"]> =
  inferProcedureOutput<TrpcRouter["_def"]["mutations"][TRouteKey]>;

export type inferMutationInput<TRouteKey extends keyof TrpcRouter["_def"]["mutations"]> =
  inferProcedureInput<TrpcRouter["_def"]["mutations"][TRouteKey]>;
