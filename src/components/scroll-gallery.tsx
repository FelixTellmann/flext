import { ArrowLongLeftIcon, ArrowLongRightIcon } from "@heroicons/react/24/solid";
import type { FC, PropsWithChildren } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { scrollToX } from "utils/scroll-to";

export const ScrollGallery: FC<PropsWithChildren<{ itemWidth: number; gapWidth: number; filter: string }>> = ({
  itemWidth,
  gapWidth,
  children,
  filter,
}) => {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [scrollNavigation, setScrollNavigation] = useState({ prev: false, next: true });
  const [isScrolling, setIsScrolling] = useState(false);

  const handleClickPrevious = useCallback(() => {
    if (isScrolling) return;
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    scrollContainer.classList.remove("snap-x");
    setIsScrolling(true);
    scrollToX(200, Math.max(scrollContainer?.scrollLeft - itemWidth - gapWidth, 0), scrollContainer, () => {
      setIsScrolling(false);
      scrollContainer.classList.add("snap-x");
    });
  }, [gapWidth, isScrolling, itemWidth]);

  const handleClickNext = useCallback(() => {
    if (isScrolling) return;
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    scrollContainer.classList.remove("snap-x");
    setIsScrolling(true);
    scrollToX(200, scrollContainer.scrollLeft + itemWidth + gapWidth, scrollContainer, () => {
      setIsScrolling(false);
      scrollContainer.classList.add("snap-x");
    });
  }, [gapWidth, isScrolling, itemWidth]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    const updateScrollNavigation = () => {
      setScrollNavigation(() => ({
        prev: scrollContainer?.scrollLeft > 0,
        next: scrollContainer.children[scrollContainer.children.length - 1]?.getBoundingClientRect().right > window.innerWidth,
      }));
    };

    scrollContainer?.addEventListener("scroll", updateScrollNavigation);
    return () => {
      scrollContainer?.removeEventListener("scroll", updateScrollNavigation);
    };
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    scrollContainer.classList.remove("snap-x");
    setIsScrolling(true);
    scrollToX(200, 0, scrollContainer, () => {
      setIsScrolling(false);
      scrollContainer.classList.add("snap-x");
    });
  }, [filter, gapWidth, itemWidth]);

  return (
    <>
      <div className="relative">
        <main
          className="sm:scrollbar-none group relative flex snap-x snap-mandatory scroll-pl-[max(var(--slider-padding),calc((100%-72rem)/2+var(--slider-padding)))] gap-8 overflow-x-auto px-[max(var(--slider-padding),calc((100%-72rem)/2+var(--slider-padding)))] py-12 [--slider-padding:2rem]"
          ref={scrollContainerRef}
        >
          {children}
        </main>
        <button
          type="button"
          className="absolute bottom-0 left-10 hidden items-center gap-2 px-4 py-2 d:hfa:text-gray-50 d:text-gray-300 h:text-gray-900 text-gray-500 text-sm transition-all duration-75 d:disabled:hfa:text-gray-700 d:disabled:text-gray-700 disabled:h:text-gray-300 disabled:text-gray-300 md:flex"
          onClick={handleClickPrevious}
          disabled={!scrollNavigation.prev}
        >
          <ArrowLongLeftIcon className="mt-0.5 h-5 w-5" />
          prev
        </button>

        <button
          type="button"
          className="absolute right-10 bottom-0 hidden items-center gap-2 px-4 py-2 d:hfa:text-gray-50 d:text-gray-300 h:text-gray-900 h:text-gray-900 text-gray-500 text-sm transition-all duration-75 d:disabled:hfa:text-gray-700 d:disabled:text-gray-700 disabled:h:text-gray-300 disabled:text-gray-300 md:flex"
          onClick={handleClickNext}
          disabled={!scrollNavigation.next}
        >
          next
          <ArrowLongRightIcon className="mt-0.5 h-5 w-5" />
        </button>
      </div>
    </>
  );
};
