import { type FC, type ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  aspectRatio?: number;
  maxHeight?: number;
  maxWidth?: number;
  pixelDensity?: number;
  preload?: boolean;
  quality?: number;
};

export const Image: FC<ImageProps> = ({ pixelDensity = 1, preload, src, width, height, maxWidth, maxHeight, aspectRatio, quality, ...rest }) => {
  if (!src || src === "undefined") return null;

  const w = +(width ?? 0);
  const h = +(height ?? 0);
  const aspect = aspectRatio ?? (h ? w / h : undefined);

  const finalWidth = Math.round(+(maxWidth ? maxWidth : maxHeight && aspect ? maxHeight * aspect : w) * pixelDensity);
  const finalHeight = Math.round(+(maxHeight ? maxHeight : maxWidth && aspect ? maxWidth / aspect : h) * pixelDensity);

  const normalizedSrc = typeof src === "string" ? src.replace(/^(http:)?\/\//, "https://") : src;

  return <img {...rest} src={normalizedSrc} width={finalWidth} height={finalHeight} loading={preload ? "eager" : "lazy"} />;
};
