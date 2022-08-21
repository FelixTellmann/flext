/**
 * This file contains tRPC's HTTP response handler
 */
import * as trpcNext from "@trpc/server/adapters/next";
import { trpcRouter } from "_server/api-routes";

import { trpcContext } from "_server/trpc/context";

export default trpcNext.createNextApiHandler({
  router: trpcRouter,
  /**
   * @link https://trpc.io/docs/context
   */
  createContext: trpcContext,
  /**
   * @link https://trpc.io/docs/error-handling
   */
  onError({ error }) {
    console.log(error);
    if (error.code === "INTERNAL_SERVER_ERROR") {
      // send to bug reporting
      console.error("Something went wrong", error);
    }
  },
  /**
   * Enable query batching
   */
  batching: {
    enabled: true,
  },
  /**
   * @link https://trpc.io/docs/caching#api-response-caching
   */
  responseMeta({ ctx, paths, type, errors }) {
    // assuming you have all your public routes with the keyword `public` in them
    const github = paths && paths.every((path) => path.includes("fetch.github"));
    // checking that no procedures errored
    const allOk = errors.length === 0;
    // checking we're doing a query request
    const isQuery = type === "query";

    if (ctx && github && allOk && isQuery) {
      // cache request for 1 day + revalidate once every second
      const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
      /*return {
        headers: {
          "cache-control": `s-maxage=${ONE_DAY_IN_SECONDS}`,
        },
      };*/
    }
    return {};
  },
});
