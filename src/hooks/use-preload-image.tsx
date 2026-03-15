import { useIsGloballyMounted } from "~/stores/is-globally-mounted-store";
import { usePreloadedImages } from "~/stores/preloaded-images-store";
import { useCallback } from "react";

type UsePreloadImageHook = () => (props: { src: string; width: number; quality?: number }) => void;

export const usePreloadImage: UsePreloadImageHook = () => {
  const [isMounted] = useIsGloballyMounted();
  const [preloadedImages, setPreloadedImages] = usePreloadedImages();

  return useCallback(
    ({ src, width, quality = 75 }) => {
      if (!isMounted) return;

      const normalizedSrc = src.replace(/^\/\//, "https://");
      const imageString = `${normalizedSrc}_${width}_${quality}`;

      if (preloadedImages.includes(imageString)) {
        return;
      }
      setPreloadedImages((currentPreloadImages) => [...currentPreloadImages, imageString]);

      // Preload using a simple link preload with the direct image URL
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = normalizedSrc;
      document.head.appendChild(link);
    },
    [isMounted, preloadedImages, setPreloadedImages],
  );
};

export default usePreloadImage;
