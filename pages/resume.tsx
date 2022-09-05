import { Image } from "_client/image";
import { Link } from "_client/link";
import clsx from "clsx";
import { HoverEffect } from "components/layout/header.desktop-nav.hover-effect";
import { CV } from "content/cv";
import { FC, useEffect, useRef } from "react";
import ProfilePic from "public/images/about/resume-profile.jpg";

type ResumeProps = {};

export const Resume: FC<ResumeProps> = (props) => {
  return (
    <>
      <article className="relative mx-auto grid max-w-6xl grid-cols-[1fr_240px] gap-12 px-4 py-16 md:px-8">
        <main className="min-h-[200vh] snap-y snap-normal spacing-10">
          <section id="intro" className="scroll-mt-[122px] spacing-4">
            <h2 className="text-3xl font-bold tracking-tight text-gray-800">Intro</h2>
            <hr className="h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
            <p className="text-[15px] leading-relaxed text-gray-500">
              Welcome I'm Felix Tellmann, I am looking for work to do this and that Lorem ipsum
              dolor sit amet, consectetur adipisicing elit. Accusamus architecto cum, enim error
              est, et fuga hic iusto maiores modi numquam, quas rem sit unde veritatis? Dolore illo
              iure natus? A blanditiis cumque ducimus facilis incidunt iure nemo officiis
              voluptatibus?
            </p>
          </section>
          <section id="experience" className="scroll-mt-[122px] spacing-4">
            <h2 className="text-3xl font-bold tracking-tight text-gray-800">Experience</h2>
            <hr className=" h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
            <main className="spacing-8">
              {CV.experience
                .sort((a, b) => {
                  if (new Date(a.dateFrom) < new Date(b.dateFrom)) return 1;
                  if (new Date(a.dateFrom) > new Date(b.dateFrom)) return -1;
                  return 0;
                })
                .map(
                  (
                    {
                      dateFrom,
                      dateTo,
                      city,
                      country,
                      title,
                      responsibilities,
                      company,
                      description,
                    },
                    index,
                    arr
                  ) => {
                    return (
                      <section className="relative flex" key={index}>
                        <aside className="absolute left-4 top-1 h-full">
                          <div className="absolute left-0 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-gray-200">
                            <h3 className="absolute top-0 right-full mr-6 text-right text-xs font-medium leading-[16px] text-gray-400">
                              <span className="spacing-1">
                                <span className="mr-2 whitespace-nowrap">
                                  {new Date(dateFrom)?.toLocaleDateString("en-GB", {
                                    month: "short",
                                    year: "numeric",
                                  })}{" "}
                                  -
                                </span>
                                {/*<span className="text-gray-400">to</span>*/}
                                <span className="whitespace-nowrap">
                                  {new Date(dateTo)?.toLocaleDateString("en-GB", {
                                    month: "short",
                                    year: "numeric",
                                  })}
                                </span>
                              </span>
                            </h3>
                            <div className="h-2 w-2 rounded-full bg-gray-400" />
                          </div>
                          <i
                            className={clsx(
                              "absolute left-0 top-6 h-[calc(100%-2px)] w-0.5 -translate-x-1/2",
                              index === arr.length - 1
                                ? "bg-gradient-to-b from-gray-200 to-transparent"
                                : "bg-gray-200"
                            )}
                          />
                        </aside>

                        <main className="ml-12 spacing-1">
                          <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                            <strong className="text-[17px] font-bold text-gray-900">{title}</strong>{" "}
                            <span className="flex items-baseline gap-2">
                              <span className="font-semibold text-gray-600">{company}</span>
                              <span className="select-none text-sm text-gray-300">-</span>
                              <span className="font-medium text-gray-500">
                                {city}, {country}
                              </span>
                            </span>
                          </h3>
                          {description
                            ? <p className="text-sm leading-relaxed text-gray-600">{description}</p>
                            : null}
                          <ul className="list-outside list-disc pl-4 text-sm text-gray-500 marker:text-gray-400">
                            {responsibilities.map((responsibility, index) => (
                              <li className="pl-3" key={index}>
                                {responsibility.content}
                              </li>
                            ))}
                          </ul>
                        </main>
                      </section>
                    );
                  }
                )}
            </main>
          </section>
          <section id="education" className="scroll-mt-[122px] spacing-4">
            <h2 className="text-3xl font-bold tracking-tight text-gray-800">Education</h2>
            <hr className=" h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
            <main className="spacing-8">
              {CV.eduction
                .sort((a, b) => {
                  if (new Date(a.dateFrom) < new Date(b.dateFrom)) return 1;
                  if (new Date(a.dateFrom) > new Date(b.dateFrom)) return -1;
                  return 0;
                })
                .map(
                  (
                    { dateFrom, dateTo, city, country, institution, certificate, level },
                    index,
                    arr
                  ) => {
                    return (
                      <section className="relative flex" key={index}>
                        <aside className="absolute left-4 top-1 h-full">
                          <div className="absolute left-0 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-gray-200">
                            <h3 className="absolute top-0 right-full mr-6 text-right text-xs font-medium leading-[16px] text-gray-400">
                              <span className="spacing-1">
                                <span className="mr-2 whitespace-nowrap">
                                  {new Date(dateFrom)?.toLocaleDateString("en-GB", {
                                    month: "short",
                                    year: "numeric",
                                  })}{" "}
                                  -
                                </span>
                                {/*<span className="text-gray-400">to</span>*/}
                                <span className="whitespace-nowrap">
                                  {new Date(dateTo)?.toLocaleDateString("en-GB", {
                                    month: "short",
                                    year: "numeric",
                                  })}
                                </span>
                              </span>
                            </h3>
                            <div className="h-2 w-2 rounded-full bg-gray-400" />
                          </div>
                          <i
                            className={clsx(
                              "absolute left-0 top-6 h-[calc(100%-2px)] w-0.5 -translate-x-1/2",
                              index === arr.length - 1
                                ? "bg-gradient-to-b from-gray-200 to-transparent"
                                : "bg-gray-200"
                            )}
                          />
                        </aside>

                        <main className="ml-12 spacing-1">
                          <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                            <strong className="text-[17px] font-bold text-gray-900">
                              {certificate}
                            </strong>{" "}
                            <span className="flex items-baseline gap-2">
                              <span className="font-semibold text-gray-600">{institution}</span>
                              <span className="select-none text-sm text-gray-300">-</span>
                              <span className="font-medium text-gray-500">
                                {city}, {country}
                              </span>
                            </span>
                          </h3>
                          {/*{description
                            ? <p className="text-sm leading-relaxed text-gray-600">{description}</p>
                            : null}
                          <ul className="list-outside list-disc pl-4 text-sm text-gray-500 marker:text-gray-400">
                            {responsibilities.map((responsibility, index) => (
                              <li className="pl-3" key={index}>
                                {responsibility.content}
                              </li>
                            ))}
                          </ul>*/}
                        </main>
                      </section>
                    );
                  }
                )}
            </main>
          </section>
          <section id="skills" className="scroll-mt-[122px] spacing-4">
            <h2 className="text-3xl font-bold tracking-tight text-gray-800">Skills</h2>
            <hr className=" h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
            <main className="spacing-8">tbc</main>
          </section>
          <section id="references" className="scroll-mt-[122px] spacing-4">
            <h2 className="text-3xl font-bold tracking-tight text-gray-800">References</h2>
            <hr className=" h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
            <main className="spacing-8">tbc</main>
          </section>
        </main>
        <aside className="sticky top-[144px] mb-auto max-h-min spacing-8">
          <section className="h-64">
            <figure className="relative -top-2 z-0 h-56 w-44 rotate-6">
              <div className="absolute -inset-x-10 top-0 h-0.5 bg-slate-900/[0.1] [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
              <div className="absolute -inset-y-10 right-0 w-0.5 bg-slate-900/[0.1] [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
              <div className="absolute -inset-x-10 bottom-0 h-0.5 bg-slate-900/[0.1] [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
              <div className="absolute -inset-y-10 left-0 w-0.5 bg-slate-900/[0.1] [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
              <div className="absolute bottom-full right-0 -mb-px flex h-8 items-end overflow-hidden">
                <div className="-mb-px flex h-[2px] w-44 -scale-x-100">
                  <div className="w-full flex-none blur-sm [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                  <div className="-ml-[100%] w-full flex-none blur-[1px] [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                </div>
              </div>
              <div className="absolute top-[calc(100%-1px)] left-2 -mb-px flex h-8 items-start overflow-hidden">
                <div className="-mt-px flex h-[2px] w-44 -scale-x-100">
                  <div className="w-full flex-none blur-sm [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]"></div>
                  <div className="-ml-[100%] w-full flex-none blur-[1px] [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]"></div>
                </div>
              </div>
              <div className="flex h-full items-center justify-center px-2">
                <Image
                  src={ProfilePic}
                  className="rounded-sm shadow-xl shadow-sky-400/10"
                  alt="Felix Tellmann Profile Pic"
                  width="176"
                  height="224"
                  pixelDensity={2}
                />
              </div>
            </figure>
          </section>
          <section className="">
            <nav className="relative whitespace-nowrap text-[15px] font-medium text-gray-400 spacing-0">
              <HoverEffect className="border-none bg-gray-100" />
              <Link
                className="w-min rounded-md px-2 py-1 transition-all duration-75 hfa:text-gray-700"
                href="#intro"
              >
                Intro
              </Link>
              <Link
                className="w-min rounded-md px-2 py-1 transition-all duration-75 hfa:text-gray-700"
                href="#experience"
              >
                Experience
              </Link>
              <Link
                className="w-min rounded-md px-2 py-1 transition-all duration-75 hfa:text-gray-700"
                href="#education"
              >
                Education
              </Link>
              <Link
                className="w-min rounded-md px-2 py-1 transition-all duration-75 hfa:text-gray-700"
                href="#skills"
              >
                Personal Development
              </Link>
              <Link
                className="w-min rounded-md px-2 py-1 transition-all duration-75 hfa:text-gray-700"
                href="#skills"
              >
                Certifications
              </Link>
              <Link
                className="w-min rounded-md px-2 py-1 transition-all duration-75 hfa:text-gray-700"
                href="#references"
              >
                References
              </Link>
            </nav>
          </section>
        </aside>
      </article>
    </>
  );
};

export default Resume;
