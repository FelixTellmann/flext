import { About } from "components/sections/about";
import { Hero } from "components/sections/hero";
import { PortfolioPreview } from "components/sections/portfolio-preview";
import { Timeline } from "components/sections/timeline";
import party from "party-js";
import { FC } from "react";

party.settings.respectReducedMotion = false;

export const Index: FC = (props) => {
  return (
    <>
      <Hero />
      <About />
      <Timeline />
      <PortfolioPreview />
    </>
  );
};

export default Index;
