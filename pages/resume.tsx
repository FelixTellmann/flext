import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { Image } from "_client/image";
import { Link } from "_client/link";

import clsx from "clsx";
import { HoverEffect } from "components/layout/header.desktop-nav.hover-effect";
import { useToast } from "components/toast";
import { CV } from "content/cv";
import { useInView } from "framer-motion";
import produce from "immer";
import { FC, PropsWithChildren, useEffect, useRef, useState } from "react";
import ProfilePic from "public/images/about/resume-profile.jpg";
import { useIntersection, useWindowSize } from "react-use";
import { toKebabCase } from "utils/to-kebab-case";

import create from "zustand";

type ResumeSectionInViewStore = {
  sections: {
    intro: { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
    experience: { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
    education: { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
    "tech-skills": { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
    references: { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
  };
  updateSection: (
    id: keyof ResumeSectionInViewStore["sections"],
    showing: boolean,
    centerVisible: boolean,
    fullyVisible: boolean
  ) => void;
};

export const useResumeSectionInView = create<ResumeSectionInViewStore>((set) => ({
  sections: {
    intro: { showing: true, centerVisible: false, fullyVisible: false },
    experience: { showing: true, centerVisible: false, fullyVisible: false },
    education: { showing: true, centerVisible: false, fullyVisible: false },
    "tech-skills": { showing: true, centerVisible: false, fullyVisible: false },
    references: { showing: true, centerVisible: false, fullyVisible: false },
  },
  updateSection: (id, showing, centerVisible, fullyVisible) => {
    set(
      produce((state) => {
        state.sections[id] = { showing, centerVisible, fullyVisible };
      })
    );
  },
}));

type ResumeProps = {};

const ResumeSection: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => {
  const sectionContentRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [contentHeight, setContentHeight] = useState<number>(0);
  const [showSection, setShowSection] = useState(true);
  const centerVisible = useInView(sectionRef, { margin: "-40% 0px -40% 0px" });
  const fullyVisible = useInView(sectionRef, { amount: 0.9 });
  const { width } = useWindowSize();
  const { updateSection } = useResumeSectionInView();

  useEffect(() => {
    if (sectionContentRef.current) {
      const element = sectionContentRef.current;
      setContentHeight(element.clientHeight);
      element.style.maxHeight = element.clientHeight !== 0 ? `${element!.clientHeight}px` : "";
    }
  }, []);

  useEffect(() => {
    const element = sectionContentRef.current;
    if (showSection && element) {
      setTimeout(
        () => {
          element.style.maxHeight = "";
        },
        160
      );
      setTimeout(
        () => {
          element.style.maxHeight = element.clientHeight !== 0 ? `${element!.clientHeight}px` : "";
        },
        500
      );
    }
  }, [showSection]);

  useEffect(() => {
    const element = sectionContentRef.current;
    if (element && !element.classList.contains("!max-h-0") && element.style.maxHeight) {
      sectionContentRef.current.style.maxHeight = "";
    }
  }, [width]);

  useEffect(() => {
    updateSection(
      toKebabCase(title) as keyof ResumeSectionInViewStore["sections"],
      showSection,
      centerVisible,
      fullyVisible
    );
  }, [centerVisible, fullyVisible, showSection, title, updateSection]);

  return (
    <section id={toKebabCase(title)} className="scroll-mt-[122px] spacing-4" ref={sectionRef}>
      <header className="spacing-3">
        <h2 className="flex items-baseline justify-between">
          <span
            className="text-3xl font-bold tracking-tight text-gray-800"
            onClick={() => setShowSection(true)}
          >
            {title}
          </span>
          <button
            className="group mr-2 rounded p-2 text-gray-400/90 transition-colors hfa:outline-none hf:bg-gray-100 hf:text-gray-900 "
            onClick={() => setShowSection((current) => !current)}
          >
            <span className="sr-only">Toggle Section Visibility</span>
            <ChevronDownIcon
              className={clsx("h-4 w-4 transition-all", showSection ? "" : "rotate-180")}
            />
          </button>
        </h2>
        <hr className="h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
      </header>
      <main
        ref={sectionContentRef}
        className={clsx(
          "transition-all duration-200 ease-linear",
          !showSection && "!max-h-0 overflow-hidden opacity-0"
        )}
      >
        <div className="transition-[all,height] delay-[0s,0.2s]"></div>
        {children}
      </main>
    </section>
  );
};

export const Resume: FC<ResumeProps> = (props) => {
  const { sections } = useResumeSectionInView();
  const [inView, setInView] = useState("intro");

  useEffect(() => {
    for (const key in sections) {
      const val = sections[key];
      if (!val.showing) continue;

      if (val.centerVisible && val.fullyVisible) {
        setInView(key);
        break;
      }

      if (val.fullyVisible) {
        setInView(key);
        break;
      }

      if (val.centerVisible) {
        setInView(key);
        break;
      }
      setInView("");
    }
  }, [sections]);

  return (
    <>
      <article className="relative mx-auto grid max-w-6xl grid-cols-[1fr_240px] gap-12 px-4 py-16 md:px-8">
        <main className="min-h-[200vh] snap-y snap-normal spacing-10">
          <ResumeSection title="Intro">
            <p className="text-[15px] leading-relaxed text-gray-500">{CV.intro}</p>
          </ResumeSection>

          <ResumeSection title="Experience">
            <div className="spacing-8">
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
                                  {Date.now() > new Date(dateTo).getTime()
                                    ? new Date(dateTo)?.toLocaleDateString("en-GB", {
                                        month: "short",
                                        year: "numeric",
                                      })
                                    : "Current"}
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
                              <span className="text-gray-400/80">
                                {city && country
                                  ? <>
                                      {city}, {country}
                                    </>
                                  : <>
                                      {city}
                                      {country}
                                    </>}
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
            </div>
          </ResumeSection>

          <ResumeSection title="Education">
            <div className="spacing-8">
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
                              <span className="whitespace-nowrap">
                                {new Date(dateTo)?.toLocaleDateString("en-GB", {
                                  year: "numeric",
                                })}
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
            </div>
          </ResumeSection>

          <ResumeSection title="Tech Skills">
            <div className="spacing-8">
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Languages</strong>{" "}
                </h3>
                <p className="text-sm text-gray-500 marker:text-gray-400">
                  {CV.skills.programmingLanguages
                    .map((language, index) => language.name)
                    .join(", ")}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">
                    Libraries & Frameworks
                  </strong>{" "}
                </h3>
                <p className="text-sm text-gray-500 marker:text-gray-400">
                  {CV.skills.librariesFrameworks.map((language, index) => language.name).join(", ")}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Service Providers</strong>{" "}
                </h3>
                <p className="text-sm text-gray-500 marker:text-gray-400">
                  {CV.skills.serviceProviders.map((language, index) => language.name).join(", ")}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Content Platforms</strong>{" "}
                </h3>
                <p className="text-sm text-gray-500 marker:text-gray-400">
                  {CV.skills.dataProviders.map((language, index) => language.name).join(", ")}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Tools</strong>{" "}
                </h3>
                <p className="text-sm text-gray-500 marker:text-gray-400">
                  {CV.skills.tools.map((language, index) => language.name).join(", ")}
                </p>
              </section>
            </div>
          </ResumeSection>

          {/*<ResumeSection title="Tech Skills">
            <div className="spacing-8">
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Languages</strong>{" "}
                </h3>
                <p className="flex flex-wrap gap-2 text-xs font-medium text-gray-500 marker:text-gray-400">
                  {CV.skills.programmingLanguages.map(({ name, Icon }, index) => (
                    <div
                      key={name}
                      className="flex select-none items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-0.5 h:border-gray-200 h:bg-gray-300/40"
                    >
                      {Icon ? <Icon className="h-4 w-4 p-px" /> : null}
                      <span>{name}</span>
                    </div>
                  ))}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">
                    Libraries & Frameworks
                  </strong>{" "}
                </h3>
                <p className="flex flex-wrap gap-2 text-xs font-medium text-gray-500 marker:text-gray-400">
                  {CV.skills.librariesFrameworks.map(({ name, Icon }, index) => (
                    <div
                      key={name}
                      className="flex select-none items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-0.5 h:border-gray-200 h:bg-gray-300/40"
                    >
                      {Icon ? <Icon className="h-4 w-4 p-px" /> : null}
                      <span>{name}</span>
                    </div>
                  ))}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Service Providers</strong>{" "}
                </h3>
                <p className="flex flex-wrap gap-2 text-xs font-medium text-gray-500 marker:text-gray-400">
                  {CV.skills.serviceProviders.map(({ name, Icon }, index) => (
                    <div
                      key={name}
                      className="flex select-none items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-0.5 h:border-gray-200 h:bg-gray-300/40"
                    >
                      {Icon ? <Icon className="h-4 w-4 p-px" /> : null}
                      <span>{name}</span>
                    </div>
                  ))}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Content Platforms</strong>{" "}
                </h3>
                <p className="flex flex-wrap gap-2 text-xs font-medium text-gray-500 marker:text-gray-400">
                  {CV.skills.dataProviders.map(({ name, Icon }, index) => (
                    <div
                      key={name}
                      className="flex select-none items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-0.5 h:border-gray-200 h:bg-gray-300/40"
                    >
                      {Icon ? <Icon className="h-4 w-4 p-px" /> : null}
                      <span>{name}</span>
                    </div>
                  ))}
                </p>
              </section>
              <section className="relative max-w-prose spacing-1">
                <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                  <strong className="text-[17px] font-bold text-gray-900">Tools</strong>{" "}
                </h3>
                <p className="flex flex-wrap gap-2 text-xs font-medium text-gray-500 marker:text-gray-400">
                  {CV.skills.tools.map(({ name, Icon }, index) => (
                    <div
                      key={name}
                      className="flex select-none items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-0.5 h:border-gray-200 h:bg-gray-300/40"
                    >
                      {Icon ? <Icon className="h-4 w-4 p-px" /> : null}
                      <span>{name}</span>
                    </div>
                  ))}
                </p>
              </section>
            </div>
          </ResumeSection>*/}

          <ResumeSection title="References">TBC</ResumeSection>
        </main>
        <aside className="sticky top-[144px] mb-auto max-h-min spacing-8">
          <section className="h-64">
            <figure className="relative -top-2 z-0 ml-auto h-56 w-44 rotate-6">
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
                  priority
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
            <nav className="relative items-end whitespace-nowrap text-[15px] font-medium text-gray-300 spacing-0">
              <HoverEffect className="border-none border-transparent bg-gray-100" />
              <Link
                className={clsx(
                  "w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                  inView === "intro" ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                )}
                href="#intro"
              >
                Intro
              </Link>
              <Link
                className={clsx(
                  "w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                  inView === "experience" ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                )}
                href="#experience"
              >
                Experience
              </Link>
              <Link
                className={clsx(
                  "w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                  inView === "education" ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                )}
                href="#education"
              >
                Education
              </Link>
              <Link
                className={clsx(
                  "w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                  inView === "tech-skills" ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                )}
                href="#tech-skills"
              >
                Tech Skills
              </Link>
              <Link
                className={clsx(
                  "w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                  inView === "skills" ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                )}
                href="#skills"
              >
                Certifications
              </Link>
              <Link
                className={clsx(
                  "w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                  inView === "references" ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                )}
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
