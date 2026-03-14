import clsx from "clsx";
import { FC, PropsWithChildren } from "react";
import { capitalize } from "utils/capitalize";

export type BadgeProps = {
  size?: "sm" | "md" | "lg";
  style?:
    | "plain"
    | "info"
    | "success"
    | "attention"
    | "warning"
    | "critical"
    | "disabled"
    | "accent";
};

export const Badge: FC<PropsWithChildren<BadgeProps>> = ({
  children,
  size = "md",
  style = "plain",
}) => {
  return (
    <span
      className={clsx(
        "inline-flex select-none items-center whitespace-nowrap rounded-md border-2 font-medium transition-all",
        {
          sm: "px-1.5 py-0.5 text-xs",
          md: "px-2.5 py-0.5 text-[13px]",
          lg: "px-3 py-1 text-[13px]",
        }[size],
        {
          info: "cursor-pointer border-cyan-700/20 bg-cyan-100 text-cyan-900 hfa:bg-cyan-200/90 d:border-cyan-400/30 d:bg-gradient-to-b d:from-cyan-900/90 d:to-cyan-900/90 d:text-cyan-100 d:hfa:from-cyan-900/70 d:hfa:to-cyan-900/70",
          success:
            "cursor-pointer border-green-700/20 bg-green-100 text-green-900 hfa:bg-green-200/90 d:border-green-400/30 d:bg-gradient-to-b d:from-green-900/90 d:to-green-900/90 d:text-green-100 d:hfa:from-green-900/70 d:hfa:to-green-900/70",
          attention:
            "cursor-pointer border-yellow-700/20 bg-yellow-100 text-yellow-900 hfa:bg-yellow-200/90 d:border-yellow-400/30 d:bg-gradient-to-b d:from-yellow-900/90 d:to-yellow-900/90 d:text-yellow-100 d:hfa:from-yellow-900/70 d:hfa:to-yellow-900/70",
          warning:
            "cursor-pointer border-orange-700/20 bg-orange-100 text-orange-900 hfa:bg-orange-200/90 d:border-orange-400/30 d:bg-gradient-to-b d:from-orange-900/90 d:to-orange-900/90 d:text-orange-100 d:hfa:from-orange-900/70 d:hfa:to-orange-900/70",
          critical:
            "cursor-pointer border-red-700/20 bg-red-100 text-red-900 hfa:bg-red-200/90 d:border-red-400/30 d:bg-gradient-to-b d:from-red-900/90 d:to-red-900/90 d:text-red-100 d:hfa:from-red-900/70 d:hfa:to-red-900/70",
          accent:
            "cursor-pointer border-pink-700/20 bg-pink-100 text-pink-900 hfa:bg-pink-200/90 d:border-pink-400/30 d:bg-gradient-to-b d:from-pink-900/90 d:to-pink-900/90 d:text-pink-100 d:hfa:from-pink-900/70 d:hfa:to-pink-900/70",
          plain:
            "cursor-pointer border-gray-700/20 bg-gray-100 text-gray-900 hfa:bg-gray-200/90 d:border-gray-400/30 d:bg-gradient-to-b d:from-gray-900/90 d:to-gray-900/90 d:text-gray-100 d:hfa:from-gray-900/70 d:hfa:to-gray-900/70",
          disabled: "cursor-not-allowed border-gray-700/5 bg-gray-100 text-gray-400",
        }[style]
      )}
    >
      {capitalize(children)}
    </span>
  );
};
