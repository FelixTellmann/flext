import { ORPCError } from "@orpc/client";
import clsx from "clsx";
import type { FC } from "react";

// The one-line outcome of a mutation, shared by every admin screen that runs one. On surfaces whose whole
// discipline is meaning-keyed colour it cannot be a single tone: "reversed" and "the reversal did not
// land" are not the same news. `info` is for outcomes where nothing was changed and nothing broke — a
// refusal, or work in flight.
export type BannerTone = "success" | "info" | "warning" | "danger";

export const banner_style: Record<BannerTone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  info: "border-info/40 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

export type OutcomeBanner = { text: string; tone: BannerTone };

// A refusal is not a crash. requireEnabledMailbox throws FORBIDDEN for a disabled mailbox and NOT_FOUND
// for an unknown one, each with a worded explanation and nothing sent to the mailbox — amber, and the
// message shown as written. Anything else reached us as a real failure and stays red.
export function toFailureBanner(prefix: string, error: unknown): OutcomeBanner {
  if (error instanceof ORPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
    return { text: error.message, tone: "warning" };
  }
  return { text: `${prefix}: ${error instanceof Error ? error.message : String(error)}`, tone: "danger" };
}

export const Banner: FC<{ banner: OutcomeBanner; className: string }> = ({ banner, className }) => (
  <p className={clsx("rounded border p-2 text-sm", banner_style[banner.tone], className)}>{banner.text}</p>
);
