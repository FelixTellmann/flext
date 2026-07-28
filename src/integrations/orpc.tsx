import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ORPCRouter } from "@server/orpc";
import { orpcRouter } from "@server/orpc";
import { createContext } from "@server/orpc/context";
import { createIsomorphicFn } from "@tanstack/react-start";

const origin = () => globalThis?.location?.origin ?? `http://localhost:${process.env.PORT ?? 3000}`;

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(orpcRouter, {
      context: createContext,
    }),
  )
  .client((): RouterClient<typeof orpcRouter> => {
    const link = new RPCLink({
      url: `${origin()}/api/orpc`,
      headers: () => ({}),
    });
    return createORPCClient(link);
  });

export const orpc: RouterClient<typeof orpcRouter> = getORPCClient();
export const orpcQuery = createTanstackQueryUtils(orpc);
