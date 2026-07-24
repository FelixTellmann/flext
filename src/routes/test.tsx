import { createFileRoute } from "@tanstack/react-router";
import type { FC } from "react";

export const Route = createFileRoute("/test")({
  component: TestPage,
});

function TestPage() {
  return <></>;
}
