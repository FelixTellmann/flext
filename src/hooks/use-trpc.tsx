// utils/trpc.ts
import { createReactQueryHooks } from "@trpc/react";
import { TrpcRouter } from "server/api-routes";

export const API = createReactQueryHooks<TrpcRouter>();
// => { useQuery: ..., useMutation: ...}

export const { useQuery, useMutation } = API;

const twentyFourHoursInMs = 1000 * 60 * 60 * 24;

export const fetchOnce = {
  refetchOnWindowFocus: false,
  refetchOnmount: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: twentyFourHoursInMs,
};
