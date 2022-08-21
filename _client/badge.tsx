import clsx from "clsx";
import { FC, PropsWithChildren } from "react";
import { capitalize } from "utils/capitalize";

export const getBadgeColor = (content) => {
  if (content === "functionality") return "border-green-800/20 bg-green-100 text-green-800";
  if (content === "analysis") return "border-blue-800/20 bg-blue-100 text-blue-800";
  if (content === "conversion rate") return "border-cyan-800/20 bg-cyan-100 text-cyan-800";

  return "border-green-800/20 bg-green-100 text-green-800";
};

export const Badge: FC<PropsWithChildren<{ size?: "sm" | "md" | "lg" }>> = ({
  children,
  size = "md",
}) => {
  return (
    <span
      className={clsx(
        "inline-flex items-center whitespace-nowrap rounded-full border font-medium",
        {
          sm: "px-1.5 py-0.5 text-xs",
          md: "px-3 py-1 text-sm",
          lg: "",
        }[size],
        getBadgeColor(children)
      )}
    >
      {capitalize(children)}
    </span>
  );
};
