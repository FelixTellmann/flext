import { createFileRoute } from "@tanstack/react-router";
import { type FC } from "react";

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});

function PortfolioPage() {
  return <>Work</>;
}
