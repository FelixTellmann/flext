import { LinkIcon } from "@heroicons/react/24/solid";
import { FaGithub } from "@react-icons/all-files/fa/FaGithub";
import { Image } from "components/image";
import { Link } from "components/link";
import clsx from "clsx";
import { ScrollGallery } from "components/scroll-gallery";
import { PORTFOLIO } from "content/portfolio-preview";
import { PROJECTS } from "content/projects";
import { FC, useCallback, useState } from "react";

type PortfolioPreviewProps = {};

export const PortfolioPreview: FC<PortfolioPreviewProps> = ({}) => {
  const [filter, setFilter] = useState("All Projects");

  return (
    <section id="portfolio" className="portfolio-preview mb-24 min-h-full spacing-4">
      <header className="mx-auto grid w-full max-w-6xl px-4 md:px-8">
        <div className="heading-pre">{PORTFOLIO.pre}</div>
        <h1 className="heading-2xl -ml-1">{PORTFOLIO.heading}</h1>
        <div className="relative -mx-4 overflow-x-auto px-4 pb-2">
          <fieldset
            className="flex gap-3"
            onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
          >
            <legend className="sr-only">Filter by Tag</legend>
            {["All Projects", ...new Set(PROJECTS.map((p) => p.type).flat())].map((type, index) => {
              return (
                <label key={type} className="flex">
                  <input
                    type="radio"
                    className="peer hidden"
                    defaultChecked={index === 0}
                    name="Tag Filter"
                    value={type}
                  />
                  <div className="cursor-pointer appearance-none whitespace-nowrap rounded-full border border-gray-200 bg-gray-400/10 py-1 px-3 text-[13px] font-medium text-gray-400 transition-colors peer-checked:text-gray-900 hfa:text-gray-500 d:border-gray-700 d:peer-checked:text-gray-50 d:hfa:text-gray-300">
                    {type}
                  </div>
                </label>
              );
            })}
          </fieldset>
        </div>
      </header>
      <ScrollGallery itemWidth={340} gapWidth={32} filter={filter}>
        {PROJECTS.map((project, index) => {
          const rotationIndex = PROJECTS.filter(
            ({ type }) => filter === "All Projects" || type.includes(filter)
          ).findIndex(({ name }) => project.name === name);

          return (
            <section
              key={project.name}
              className={clsx(
                "relative h-[380px] w-[340px] min-w-[340px] snap-start rounded-xl border-2 border-gray-700/30 bg-clip-padding p-4 shadow-xl transition-[min-width,width,margin-left,opacity] duration-300 spacing-0 d:border-white/20",
                filter === "All Projects" || project.type.includes(filter)
                  ? "flex"
                  : "-ml-8 !w-0 !min-w-0 !overflow-hidden !border-0 !px-0 opacity-20",
                rotationIndex % 2 === 0 && "sm:rotate-[1.5deg]",
                rotationIndex % 2 === 1 && "sm:rotate-[-1.5deg]",
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
                  "bg-[linear-gradient(140deg,var(--tw-gradient-stops))] from-cyan-400/80 to-indigo-700/50 shadow-indigo-700/20"
              )}
            >
              <figure className="relative flex aspect-2 w-full">
                <Image
                  preload
                  src={project.featuredImage}
                  alt={project.name}
                  width={400}
                  height={200}
                  maxWidth={320}
                  className="rounded-t-lg object-cover object-center [mask-image:linear-gradient(180deg,#fff_16.35%,rgb(255_255_255_/_0%)_91.66%)]"
                />
              </figure>
              <header>
                <h2 className="text-2xl font-bold tracking-tighter text-gray-800 d:text-white">
                  {project.name}
                </h2>
                <div className="mt-0.5 -ml-0.5 flex items-center gap-2 tracking-tight text-gray-600 d:text-gray-200">
                  {project.tech?.map(({ name, Icon }, i) => {
                    if (i > 3) return null;
                    return (
                      <div
                        key={name}
                        className="flex select-none items-center gap-1 whitespace-nowrap rounded border border-gray-700/10 bg-gray-200/30 py-[2px] px-1.5 text-[13px] font-medium hfa:bg-gray-200/60 d:bg-gray-900/20 d:text-gray-50/80 d:hfa:bg-gray-900/30"
                      >
                        {name}
                      </div>
                    );
                  })}
                </div>
              </header>
              <main className="mt-2 text-[15px] tracking-tight text-gray-600 d:text-gray-200 ">
                <p className="line-clamp-4">{project.description}</p>
              </main>
              <footer className="absolute bottom-3 left-0 mt-auto flex w-full items-end justify-end gap-2 px-4">
                <div className="mr-auto text-sm font-semibold text-gray-700/80 d:text-gray-300/80">
                  {project.year}
                </div>
                {project.repository
                  ? <Link
                      target="_blank"
                      href={project.repository}
                      className="p-1 text-gray-700/80 transition-all hfa:text-gray-900 d:text-gray-300/80 d:hfa:text-gray-50"
                      data-tip="View repository"
                    >
                      <span className="sr-only">Link to Github repository</span>
                      <FaGithub className="h-5 w-5 " />
                    </Link>
                  : null}
                {project.url
                  ? <Link
                      target="_blank"
                      href={project.url}
                      className="p-1 text-gray-700/80 transition-all hfa:text-gray-900 d:text-gray-300/80 d:hfa:text-gray-50"
                      data-tip="View site"
                    >
                      <span className="sr-only">Link to Project</span>
                      <LinkIcon className="h-5 w-5 " />
                    </Link>
                  : null}
              </footer>
            </section>
          );
        })}
      </ScrollGallery>
    </section>
  );
};
