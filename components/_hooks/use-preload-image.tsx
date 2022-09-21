import { useIsGloballyMounted } from "components/_stores/is-globally-mounted-store";
import { usePreloadedImages } from "components/_stores/preloaded-images-store";
import { useCallback } from "react";

type UsePreloadImageHook = () => (props: { src: string; width: number; quality?: number }) => void;

export const usePreloadImage: UsePreloadImageHook = () => {
  const [isMounted] = useIsGloballyMounted();
  const [preloadedImages, setPreloadedImages] = usePreloadedImages();

  return useCallback(({ src, width, quality = 75 }) => {
    if (!isMounted) return;

    const imageString = `${src.replace(/^\/\//, "https://")}_${width}_${quality}`;

    const _1xSize = [
      16, 32, 48, 64, 96, 128, 256, 384, 460, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
    ].filter((size) => size >= width)[0];

    const _2xSize = [
      16, 32, 48, 64, 96, 128, 256, 384, 460, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
    ].filter((size) => size >= width * 2)[0];

    const preloadSrcset = `/_next/image?url=${encodeURIComponent(
      src.replace(/^\/\//, "https://")
    )}&w=${_1xSize}&q=${quality} 1x, /_next/image?url=${encodeURIComponent(
      src.replace(/^\/\//, "https://")
    )}&w=${_2xSize}&q=${quality} 2x`;
    if (preloadedImages.includes(imageString)) {
      return;
    }
    setPreloadedImages((currentPreloadImages) => [...currentPreloadImages, imageString]);

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.imageSrcset = preloadSrcset;
    document.head.appendChild(link);

    // new Image().src = preloadSrcset;
  }, [isMounted, preloadedImages, setPreloadedImages]);
};

export default usePreloadImage;
