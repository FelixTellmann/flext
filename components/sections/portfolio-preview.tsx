import { Image } from "_client/image";
import { Link } from "_client/link";
import clsx from "clsx";
import { Badge } from "components/badge";
import { HeroIcon } from "components/dynamic-hero-icon";
import { ReactIcon } from "components/dynamic-react-icon";
import { HERO } from "content/index.hero";
import { PORTFOLIO } from "content/index.portfolio-preview";
import { PROJECTS } from "content/projects";
import { spans } from "next/dist/build/webpack/plugins/profiling-plugin";
import { FC, PropsWithChildren, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { scrollToX } from "utils/scroll-to";

type PortfolioPreviewProps = {};

const ScrollGallery: FC<PropsWithChildren<{ itemWidth: string; gapWidth: string }>> = ({
  itemWidth,
  gapWidth,
  children,
}) => {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [scrollNavigation, setScrollNavigation] = useState({ prev: false, next: true });

  const handleClickPrevious = useCallback(() => {
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    scrollContainer.classList.remove("snap-x");
    scrollToX(200, Math.max(scrollContainer?.scrollLeft - 340 - 32, 0), scrollContainer, () => {
      scrollContainer.classList.add("snap-x");
    });
  }, []);
  const handleClickNext = useCallback(() => {
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    scrollContainer.classList.remove("snap-x");

    scrollToX(200, scrollContainer.scrollLeft + 340 + 32, scrollContainer, () => {
      scrollContainer.classList.add("snap-x");
    });
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current as HTMLDivElement;
    const updateScrollNavigation = () => {
      setScrollNavigation(() => ({
        prev: scrollContainer?.scrollLeft > 0,
        next:
          scrollContainer.children[scrollContainer.children.length - 1]?.getBoundingClientRect()
            .right > window.innerWidth,
      }));
    };

    scrollContainer?.addEventListener("scroll", updateScrollNavigation);
    return () => {
      scrollContainer?.removeEventListener("scroll", updateScrollNavigation);
    };
  }, []);

  return (
    <>
      <div className="relative">
        <main
          className="sm:scrollbar-none relative flex snap-x snap-mandatory scroll-pl-4 gap-8 overflow-x-auto py-12 px-4 md:scroll-pl-8 md:px-8"
          ref={scrollContainerRef}
        >
          {children}
        </main>
        <button
          className="absolute left-10 bottom-0 hidden items-center gap-2 py-2 px-4 text-sm text-gray-500 transition-all duration-75 disabled:text-gray-300 h:text-gray-900 disabled:h:text-gray-300 d:text-gray-300 d:disabled:text-gray-700 d:hfa:text-gray-50 d:disabled:hfa:text-gray-700 sm:flex"
          onClick={handleClickPrevious}
          disabled={!scrollNavigation.prev}
        >
          <HeroIcon name="ArrowLongLeftIcon" className="mt-0.5 h-5 w-5" />
          prev
        </button>

        <button
          className="absolute right-10 bottom-0 hidden items-center gap-2 py-2 px-4 text-sm text-gray-500 transition-all duration-75 disabled:text-gray-300 h:text-gray-900 h:text-gray-900 disabled:h:text-gray-300 d:text-gray-300 d:disabled:text-gray-700 d:hfa:text-gray-50 d:disabled:hfa:text-gray-700 md:flex"
          onClick={handleClickNext}
          disabled={!scrollNavigation.next}
        >
          next
          <HeroIcon name="ArrowLongRightIcon" className="mt-0.5 h-5 w-5" />
        </button>
      </div>
    </>
  );
};

export const PortfolioPreview: FC<PortfolioPreviewProps> = ({}) => {
  return (
    <>
      <section className="portfolio-preview min-h-full spacing-8">
        <header className="mx-auto w-full max-w-6xl px-4 md:px-8">
          <div className="heading-pre">{PORTFOLIO.pre}</div>
          <h1 className="heading-2xl -ml-1">The work I've done over the years.</h1>
          <div>Filter by tag list</div>
        </header>
        <ScrollGallery itemWidth="340px" gapWidth="32px">
          {PROJECTS.map((project, index) => {
            return (
              <section
                key={project.name}
                className={clsx(
                  "h-[380px] w-[340px] min-w-[340px] snap-start rounded-xl border-2 border-gray-700/30 bg-clip-padding p-4 shadow-xl spacing-0 d:border-white/20",
                  index % 8 === 0 &&
                    "shadow-[currentBg] bg-[linear-gradient(40deg,var(--tw-gradient-stops))] from-pink-300/80 to-violet-500/40 shadow-violet-500/20",
                  index % 8 === 1 &&
                    "bg-[linear-gradient(120deg,var(--tw-gradient-stops))] from-yellow-300/80 to-rose-600/80 shadow-rose-600/20",
                  index % 8 === 2 &&
                    "bg-[linear-gradient(180deg,var(--tw-gradient-stops))] from-gray-200/40 to-rose-500/80 shadow-rose-500/20",
                  index % 8 === 3 &&
                    "bg-[linear-gradient(120deg,var(--tw-gradient-stops))] from-green-400/70 to-cyan-600/80 shadow-cyan-600/20",
                  index % 8 === 4 &&
                    "bg-[linear-gradient(140deg,var(--tw-gradient-stops))] from-orange-500/50 to-yellow-500/80 shadow-yellow-500/20",
                  index % 8 === 5 &&
                    "bg-[linear-gradient(200deg,var(--tw-gradient-stops))] from-purple-500/80 to-sky-600/40 shadow-sky-600/20",
                  index % 8 === 6 &&
                    "bg-[linear-gradient(70deg,var(--tw-gradient-stops))] from-emerald-400/80 to-teal-600/40 shadow-teal-600/20",
                  index % 8 === 7 &&
                    "bg-[linear-gradient(140deg,var(--tw-gradient-stops))] from-cyan-400/80 to-indigo-600/95 shadow-indigo-600/20"
                )}
                style={{
                  transform: index % 2 === 0 ? `rotate(1.5deg)` : `rotate(-1.5deg)`,
                }}
              >
                <figure className="relative flex aspect-2 w-full">
                  <Image
                    src={project.featuredImage}
                    alt={project.name}
                    width={400}
                    height={400}
                    className="rounded-t-lg object-cover object-center [mask-image:linear-gradient(180deg,#fff_16.35%,rgb(255_255_255_/_0%)_91.66%)]"
                  />
                </figure>
                <header>
                  <h2 className="text-2xl font-bold tracking-tighter text-gray-800 d:text-white">
                    {project.name}
                  </h2>
                  <div className="mb-2 mt-1 flex flex-wrap items-center gap-2 tracking-tight text-gray-600 d:text-gray-200">
                    {project.tech?.map((tech, i) => {
                      if (i > 2) return null;
                      return (
                        <div
                          key={tech.name}
                          className="flex select-none items-center gap-1 rounded border border-gray-700/10 bg-gray-200/30 py-[3px] px-2 text-[13px] font-medium hfa:bg-gray-200/60 d:bg-gray-900/20 d:text-gray-50/60 d:hfa:bg-gray-900/30"
                        >
                          <ReactIcon name={tech.icon} className="h-3 w-3 " />
                          {tech.name}
                        </div>
                      );
                    })}
                  </div>
                </header>
                <main className="mt-1 text-[15px] tracking-tight text-gray-600 d:text-gray-200 ">
                  <p className="line-clamp-4">{project.description}</p>
                </main>
                <footer className="absolute bottom-3 right-3 mt-auto flex justify-end gap-2">
                  {project.repository
                    ? <Link
                        href={project.repository}
                        className="p-1 text-gray-700/80 transition-all hfa:text-gray-900 d:text-gray-300/80 d:hfa:text-gray-50"
                        data-tip="View repository"
                      >
                        <span className="sr-only">Link to Github repository</span>
                        <ReactIcon name="FaGithub" className="h-5 w-5 " />
                      </Link>
                    : null}
                  {project.url
                    ? <Link
                        href={project.url}
                        className="p-1 text-gray-700/80 transition-all hfa:text-gray-900 d:text-gray-300/80 d:hfa:text-gray-50"
                        data-tip="View site"
                      >
                        <span className="sr-only">Link to Project</span>
                        <HeroIcon name="LinkIcon" className="h-5 w-5 " />
                      </Link>
                    : null}
                </footer>
              </section>
            );
          })}
        </ScrollGallery>

        <footer>Show more button</footer>
      </section>
    </>
  );
};
