import { createFileRoute } from "@tanstack/react-router";
import { About } from "~/components/sections/about";
import { Hero } from "~/components/sections/hero";
import { PortfolioPreview } from "~/components/sections/portfolio-preview";
import { Timeline } from "~/components/sections/timeline";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <>
      <Hero />
      <About />
      <Timeline />
      <PortfolioPreview />
    </>
  );
}
