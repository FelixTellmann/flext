import { ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router";
import { type FC } from "react";

export const DefaultCatchBoundary: FC<ErrorComponentProps> = (props) => {
  return <ErrorComponent {...props} />;
};
