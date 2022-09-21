import usePreloadImage from "components/_hooks/use-preload-image";
import { ImageProps } from "next/dist/client/future/image";
import NextImage from "next/future/image";
import { FC, useEffect } from "react";
import { SetRequired } from "type-fest";

export const Image: FC<
  SetRequired<Omit<ImageProps, "src">, "width" | "height"> & {
    aspectRatio?: number;
    maxHeight?: number;
    maxWidth?: number;
    pixelDensity?: number;
    preload?: boolean;
    src?: ImageProps["src"];
  }
> = ({ pixelDensity = 1, preload, ...props }) => {
  const preloadImage = usePreloadImage();

  const { src, width, height, maxWidth, maxHeight, aspectRatio, ...rest } = props;

  const aspect = aspectRatio ?? +width / +height;

  useEffect(() => {
    if (src && typeof src === "string") {
      if (preload) {
        preloadImage({
          src,
          quality: props.quality ? +props.quality : 75,
          width: maxWidth ? maxWidth : maxHeight ? maxHeight * aspect : +width,
        });
      }
      if (!preload) {
        preloadImage({
          src,
          quality: 1,
          width: 32,
        });
      }
    }
  }, [aspect, maxHeight, maxWidth, preload, preloadImage, props.quality, src, width]);

  if (!src || src === "undefined") {
    return null;
  }

  return (
    <NextImage
      {...rest}
      priority={(typeof src !== "string" && preload) || rest.priority}
      placeholder={!preload ? "blur" : undefined}
      blurDataURL={
        typeof src === "string" && !preload
          ? `/_next/image?url=${encodeURIComponent(
              src.replace(/^(http:)?\/\//, "https://")
            )}&w=32&q=1`
          : undefined
      }
      src={typeof src === "string" ? src.replace(/^(http:)?\/\//, "https://") : src}
      width={Math.round(
        +(maxWidth ? maxWidth : maxHeight ? maxHeight * aspect : width) * pixelDensity
      )}
      height={Math.round(
        +(maxHeight ? maxHeight : maxWidth ? maxWidth / aspect : height) * pixelDensity
      )}
    />
  );
};
