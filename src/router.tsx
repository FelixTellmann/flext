import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { DefaultCatchBoundary } from "~/components/default-catch-boundary";
import { NotFound } from "~/components/not-found";
import { getContext, TanstackQueryProvider } from "~/integrations/tanstack-query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const rqContext = getContext();

  const router = createRouter({
    routeTree,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: typeof sessionStorage !== "undefined",
    context: {
      ...rqContext,
    },
    defaultPreload: "intent",
    Wrap: ({ children }: { children: React.ReactNode }) => <TanstackQueryProvider {...rqContext}>{children}</TanstackQueryProvider>,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: rqContext.queryClient });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
