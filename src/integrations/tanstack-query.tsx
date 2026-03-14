import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, type PropsWithChildren } from "react";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getContext() {
  if (typeof window === "undefined") {
    return { queryClient: makeQueryClient() };
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return { queryClient: browserQueryClient };
}

export const TanstackQueryProvider: FC<PropsWithChildren<{ queryClient: QueryClient }>> = ({ children, queryClient }) => {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
