import { ORPCError, os } from "@orpc/server";
import type { ORPCContext } from "./context";

export const pub = os.$context<ORPCContext>();

export const authed = pub.use(({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({ context: { ...context, session: context.session } });
});
