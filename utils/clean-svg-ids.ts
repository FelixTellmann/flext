import { generate } from "short-uuid";

export const cleanSvgIds = (svg: string, id: string = generate()) => {
  return svg.match(/url\(#([^)]*)\)/gi).reduce(
    (acc, rawSvgId, index) => {
      const svgId = rawSvgId.replace(/url\(#([^)]*)\)/gi, "$1");
      return acc.replaceAll(svgId, `svgId-${id}-${index}-${svgId}`);
    },
    svg
  );
};
