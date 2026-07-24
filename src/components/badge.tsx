import clsx from "clsx";
import type { FC } from "react";
import { capitalize } from "utils/capitalize";

export type BadgeProps = {
  children?: string;
  size?: "sm" | "md" | "lg";
  style?: "plain" | "info" | "success" | "attention" | "warning" | "critical" | "disabled" | "accent";
};

export const Badge: FC<BadgeProps> = ({ children, size = "md", style = "plain" }) => {
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
          info: "cursor-pointer border-cyan-700/20 d:border-cyan-400/30 bg-cyan-100 d:bg-gradient-to-b hfa:bg-cyan-200/90 d:from-cyan-900/90 d:hfa:from-cyan-900/70 d:hfa:to-cyan-900/70 d:to-cyan-900/90 d:text-cyan-100 text-cyan-900",
          success:
            "cursor-pointer border-green-700/20 d:border-green-400/30 bg-green-100 d:bg-gradient-to-b hfa:bg-green-200/90 d:from-green-900/90 d:hfa:from-green-900/70 d:hfa:to-green-900/70 d:to-green-900/90 d:text-green-100 text-green-900",
          attention:
            "cursor-pointer border-yellow-700/20 d:border-yellow-400/30 bg-yellow-100 d:bg-gradient-to-b hfa:bg-yellow-200/90 d:from-yellow-900/90 d:hfa:from-yellow-900/70 d:hfa:to-yellow-900/70 d:to-yellow-900/90 d:text-yellow-100 text-yellow-900",
          warning:
            "cursor-pointer border-orange-700/20 d:border-orange-400/30 bg-orange-100 d:bg-gradient-to-b hfa:bg-orange-200/90 d:from-orange-900/90 d:hfa:from-orange-900/70 d:hfa:to-orange-900/70 d:to-orange-900/90 d:text-orange-100 text-orange-900",
          critical:
            "cursor-pointer border-red-700/20 d:border-red-400/30 bg-red-100 d:bg-gradient-to-b hfa:bg-red-200/90 d:from-red-900/90 d:hfa:from-red-900/70 d:hfa:to-red-900/70 d:to-red-900/90 d:text-red-100 text-red-900",
          accent:
            "cursor-pointer border-pink-700/20 d:border-pink-400/30 bg-pink-100 d:bg-gradient-to-b hfa:bg-pink-200/90 d:from-pink-900/90 d:hfa:from-pink-900/70 d:hfa:to-pink-900/70 d:to-pink-900/90 d:text-pink-100 text-pink-900",
          plain:
            "cursor-pointer border-gray-700/20 d:border-gray-400/30 bg-gray-100 d:bg-gradient-to-b hfa:bg-gray-200/90 d:from-gray-900/90 d:hfa:from-gray-900/70 d:hfa:to-gray-900/70 d:to-gray-900/90 d:text-gray-100 text-gray-900",
          disabled: "cursor-not-allowed border-gray-700/5 bg-gray-100 text-gray-400",
        }[style],
      )}
    >
      {capitalize(children)}
    </span>
  );
};
