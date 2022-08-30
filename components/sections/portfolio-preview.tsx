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
import { FC } from "react";

type PortfolioPreviewProps = {};

export const PortfolioPreview: FC<PortfolioPreviewProps> = ({}) => {
  return (
    <>
      <section className="portfolio-preview min-h-full spacing-8">
        <header className="mx-auto w-full max-w-6xl px-4 md:px-8">
          <div className="heading-pre">{PORTFOLIO.pre}</div>
          <h1 className="heading-2xl -ml-1">The work I've done over the years.</h1>
          <div>Filter by tag list</div>
        </header>
        <main className="sm:scrollbar-none overflow-x-auto py-12">
          <div className="flex gap-8 px-4 md:px-8">
            {PROJECTS.map((project, index) => {
              return (
                <section
                  key={project.name}
                  className={clsx(
                    "h-[360px] w-[340px] min-w-[340px] rounded-xl border-2 border-gray-700/30 bg-clip-padding p-4 shadow-xl spacing-0",
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
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-800">
                      {project.name}
                    </h2>
                  </header>
                  <main className="mt-1 text-[15px] tracking-tight text-gray-600 ">
                    <p className="line-clamp-3">{project.description}</p>
                    <div className="flex flex-wrap items-center gap-4">
                      {project.tech?.map((tech) => {
                        return (
                          <div key={tech.name}>
                            <ReactIcon name={tech.icon} className="h-6 w-6 text-gray-600" />
                          </div>
                        );
                      })}
                    </div>
                  </main>
                  <footer className="absolute bottom-3 right-3 mt-auto flex justify-end gap-2">
                    {project.repository
                      ? <Link
                          href={project.repository}
                          className="p-1 text-gray-700/80 transition-all hfa:text-gray-900"
                          data-tip="View Repository"
                        >
                          <span className="sr-only">Link to Github Repository</span>
                          <ReactIcon name="FaGithub" className="h-5 w-5 " />
                        </Link>
                      : null}
                    {project.url
                      ? <Link
                          href={project.url}
                          className="p-1 text-gray-700/80 transition-all hfa:text-gray-900"
                          data-tip="View Project"
                        >
                          <span className="sr-only">Link to Project</span>
                          <HeroIcon name="LinkIcon" className="h-5 w-5 " />
                        </Link>
                      : null}
                  </footer>
                </section>
              );
            })}
          </div>
        </main>
        <footer>Show more button</footer>
      </section>
    </>
  );
};
