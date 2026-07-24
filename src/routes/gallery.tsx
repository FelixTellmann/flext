import { createFileRoute } from "@tanstack/react-router";
import type { FC } from "react";

export const Route = createFileRoute("/gallery")({
  component: GalleryPage,
});

function GalleryPage() {
  return <>Gallery</>;
}
