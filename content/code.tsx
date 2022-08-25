// @ts-ignore
import hero from "raw-loader!./code-blocks/hero.html"; // Adding `!!` to a request will disable all loaders specified in the configuration

export const CODE = {
  hero: `${hero}`,
};
