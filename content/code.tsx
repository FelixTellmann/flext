// @ts-ignore
import hero from "!!raw-loader!content/code-blocks/hero.tsx"; // Adding `!!` to a request will disable all loaders specified in the configuration

export const CODE = {
  hero: `${hero}`,
};
