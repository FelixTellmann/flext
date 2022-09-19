import { ChevronDoubleUpIcon, ChevronDownIcon, EnvelopeIcon } from "@heroicons/react/24/solid";
import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { SiLinkedin } from "@react-icons/all-files/si/SiLinkedin";
import { SiTwitter } from "@react-icons/all-files/si/SiTwitter";
import { Image } from "_client/image";
import { Link } from "_client/link";

import clsx from "clsx";
import { HoverEffect } from "components/layout/header.desktop-nav.hover-effect";
import { useToast } from "components/toast";
import { CV } from "content/cv";
import { SEO } from "content/seo";
import { useInView } from "framer-motion";
import produce from "immer";
import { FC, PropsWithChildren, useEffect, useRef, useState } from "react";
import ProfilePic from "public/images/about/resume-profile.jpg";
import { useIntersection, useWindowSize } from "react-use";
import { capitalize } from "utils/capitalize";
import { scrollToY } from "utils/scroll-to";
import { toKebabCase } from "utils/to-kebab-case";

import create from "zustand";

type ResumeSectionInViewStore = {
  sections: {
    [T: string]: { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
  };
  filter:
    | "relevant"
    | "all"
    | "web dev"
    | "management"
    | "restaurant"
    | "tech support"
    | "entrepreneurial";
  selectFilter: (filter: ResumeSectionInViewStore["filter"][0]) => void;
  updateSection: (
    id: keyof ResumeSectionInViewStore["sections"],
    showing: boolean,
    centerVisible: boolean,
    fullyVisible: boolean
  ) => void;
  toggleSectionShowing: (id: keyof ResumeSectionInViewStore["sections"]) => void;
  showSection: (id: keyof ResumeSectionInViewStore["sections"]) => void;
};

export const useResumeSectionInView = create<ResumeSectionInViewStore>((set) => ({
  sections: {
    intro: { showing: true, centerVisible: false, fullyVisible: false },
    experience: { showing: true, centerVisible: false, fullyVisible: false },
    education: { showing: true, centerVisible: false, fullyVisible: false },
    capabilities: { showing: true, centerVisible: false, fullyVisible: false },
    certifications: { showing: true, centerVisible: false, fullyVisible: false },
    references: { showing: true, centerVisible: false, fullyVisible: false },
  },
  filter: "relevant",
  selectFilter: (filter) => {
    set(
      produce((state) => {
        state.filter = filter;
      })
    );
  },
  updateSection: (id, showing, centerVisible, fullyVisible) => {
    set(
      produce((state) => {
        state.sections[id] = { showing, centerVisible, fullyVisible };
      })
    );
  },
  toggleSectionShowing: (id) => {
    set(
      produce((state) => {
        state.sections[id].showing = !state.sections[id].showing;
      })
    );
  },
  showSection: (id) => {
    set(
      produce((state) => {
        state.sections[id].showing = true;
      })
    );
  },
}));

const ResumeSection: FC<PropsWithChildren<{ title: string; className?: string }>> = ({
  title,
  children,
  className = "",
}) => {
  const sectionContentRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const centerVisible = useInView(sectionRef, { margin: "-45% 0px -25% 0px" });
  const fullyVisible = useInView(sectionRef, { amount: 0.9 });
  const { width } = useWindowSize();
  const { sections, filter, updateSection, toggleSectionShowing, showSection } =
    useResumeSectionInView();
  const key = toKebabCase(title) as keyof ResumeSectionInViewStore["sections"];
  const section = sections[key];

  useEffect(() => {
    if (sectionContentRef.current) {
      const element = sectionContentRef.current;
      element.style.maxHeight = element.clientHeight !== 0 ? `${element!.clientHeight}px` : "";
    }
  }, []);

  useEffect(() => {
    const element = sectionContentRef.current;
    if (section.showing && element) {
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
  }, [key, section.showing, sections]);

  useEffect(() => {
    const element = sectionContentRef.current;
    if (element && !element.classList.contains("!max-h-0") && element.style.maxHeight) {
      sectionContentRef.current.style.maxHeight = "";
    }
  }, [width, filter]);

  useEffect(() => {
    updateSection(
      toKebabCase(title) as keyof ResumeSectionInViewStore["sections"],
      section.showing,
      centerVisible,
      fullyVisible
    );
  }, [centerVisible, fullyVisible, section.showing, title, updateSection]);

  return (
    <section
      id={toKebabCase(title)}
      className={clsx(
        "relative -mx-4 scroll-mt-[122px] overflow-hidden px-4 spacing-4 print:!overflow-visible md:overflow-visible",
        className
      )}
      ref={sectionRef}
    >
      <header className="spacing-3 print:!-ml-24 ">
        <h2 className="flex items-baseline">
          <span
            className="flex items-baseline text-3xl font-bold tracking-tight text-gray-800 d:text-gray-100 print:!flex-1 print:!text-xl"
            onClick={() => showSection(key)}
          >
            <span className="min-w-[105px]">{title}</span>
            <hr className="ml-6 mr-24 hidden border-dashed border-gray-400 print:block print:!flex-1" />
          </span>
          <button
            type="button"
            className="group mr-2 ml-auto rounded p-2 text-gray-400/90 transition-colors hfa:outline-none hf:bg-gray-100 hf:text-gray-900 print:!hidden"
            onClick={() => toggleSectionShowing(key)}
          >
            <span className="sr-only">Toggle Section Visibility</span>
            <ChevronDownIcon
              className={clsx("h-4 w-4 transition-all", section.showing ? "" : "rotate-180")}
            />
          </button>
        </h2>
        <hr className="h-px border-none bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)] print:!hidden" />
      </header>
      <main
        ref={sectionContentRef}
        className={clsx(
          "relative transition-all duration-200 ease-linear",
          !section.showing && "!max-h-0 overflow-hidden opacity-0"
        )}
      >
        <div className="transition-[all,height] delay-[0s,0.2s]"></div>
        {children}
      </main>
    </section>
  );
};

type ResumeSectionDateSidebarProps = {
  dateFrom: string | Date;
  dateTo: string | Date;
  isLast: boolean;
  showDateRange: boolean;
};

const ResumeSectionDateSidebar: FC<ResumeSectionDateSidebarProps> = ({
  dateFrom,
  dateTo,
  isLast,
  showDateRange,
}) => {
  return (
    <aside className="absolute top-1 left-[4.5rem] hidden h-full print:!left-4 print:!block md:block xl:left-6 2xl:left-4 ">
      <h3 className="absolute top-0 right-full pr-6 text-right text-xs font-medium leading-[16px] text-gray-400 print:!pr-8 print:!text-sm print:!text-gray-600 xl:pr-8">
        {showDateRange
          ? <div className="spacing-1">
              <div className="whitespace-nowrap print:!mr-0 xl:mr-2">
                {new Date(dateFrom)?.toLocaleDateString("en-GB", {
                  month: "short",
                  year: "numeric",
                })}
                <span className="hidden print:!inline xl:inline"> -</span>
              </div>
              <div className="whitespace-nowrap">
                {Date.now() > new Date(dateTo).getTime()
                  ? new Date(dateTo)?.toLocaleDateString("en-GB", {
                      month: "short",
                      year: "numeric",
                    })
                  : "Current"}
              </div>
            </div>
          : <span className="whitespace-nowrap">
              {new Date(dateTo)?.toLocaleDateString("en-GB", {
                year: "numeric",
              })}
            </span>}
      </h3>
      <div className="absolute left-0 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-gray-200 d:bg-gray-400">
        <div className="h-2 w-2 rounded-full bg-gray-400 d:bg-gray-700" />
      </div>
      <i
        className={clsx(
          "absolute left-0 top-6 h-[calc(100%-2px)] w-0.5 -translate-x-1/2",
          isLast
            ? "bg-gradient-to-b from-gray-200 to-transparent d:from-gray-800 print:!via-gray-200"
            : "bg-gray-200 d:bg-gray-800"
        )}
      />
    </aside>
  );
};

const ResumeSectionDateEvents = ({
  name,
  organization,
  city,
  country,
  dateFrom,
  dateTo,
  showDateRange,
  description,
  responsibilities,
}) => {
  const { filter } = useResumeSectionInView();
  return (
    <main className="ml-0 spacing-1 print:!ml-12 md:ml-24 xl:ml-14 2xl:ml-12">
      <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
        <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!text-[18px] print:!font-semibold">
          {name}
        </strong>{" "}
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0 print:!text-[16px]">
          <span className="font-semibold text-gray-600 d:text-gray-400">{organization}</span>
          <span className="select-none text-sm text-gray-300 print:!text-gray-500">-</span>
          <span className="text-gray-400/80 print:!text-gray-500">
            {city && country
              ? <>
                  <span className="hidden print:!inline sm:inline">{city},</span> {country}
                </>
              : <>
                  {city}
                  {country}
                </>}
          </span>
        </span>
        <div className="flex gap-2 whitespace-nowrap text-xs font-semibold text-gray-500 d:text-gray-400 print:!hidden md:hidden">
          {showDateRange
            ? <>
                <span>
                  {new Date(dateFrom)?.toLocaleDateString("en-GB", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span>-</span>
                <span>
                  {Date.now() > new Date(dateTo).getTime()
                    ? new Date(dateTo)?.toLocaleDateString("en-GB", {
                        month: "short",
                        year: "numeric",
                      })
                    : "Current"}
                </span>
              </>
            : <span>
                {new Date(dateTo)?.toLocaleDateString("en-GB", {
                  year: "numeric",
                })}
              </span>}
        </div>
      </h3>
      {description ? <p className="text-sm leading-relaxed text-gray-600">{description}</p> : null}
      <ul className="list-outside list-disc pl-4 text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600 print:!text-base">
        {responsibilities
          .filter(({ type }) => type.includes(filter) || filter === "all")
          .map((responsibility, index) => (
            <li className="pl-3" key={index}>
              {responsibility.content}
            </li>
          ))}
      </ul>
    </main>
  );
};

const ResumeFooter = () => {
  const [active, setActive] = useState(false);
  const { sections, filter, showSection, selectFilter } = useResumeSectionInView();

  return (
    <footer
      className={clsx(
        "fixed inset-x-0 bottom-0 z-40 px-4 py-2 transition-all ease-linear [--resume-footer-bg:theme(colors.gray.50)] print:!hidden lg:hidden",
        active ? "max-h-72" : "max-h-10"
      )}
    >
      <div
        className="absolute inset-0 h-full w-full shadow-xl shadow-gray-700 drop-shadow-2xl"
        style={{
          background: `radial-gradient(61px 61px,#0000 24px,var(--resume-footer-bg) 0px) 0px -24px/100% 48px no-repeat, linear-gradient(0deg, transparent 0px, transparent 24px, var(--resume-footer-bg) 24px, var(--resume-footer-bg) 100%) 0px 24px/100% 100%`,
        }}
      >
        <div className="absolute top-0 left-0 w-[calc(50%-24px)] border-t border-t-gray-900/10" />
        <div className="absolute top-0 right-0 w-[calc(50%-24px)] border-t border-t-gray-900/10" />
        <div className="absolute top-0 left-1/2 h-6 w-12 -translate-x-1/2 rounded-br-full rounded-bl-full border-b border-l border-r border-gray-900/10" />
      </div>
      <button
        className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-100 bg-gray-50 p-3 text-gray-600 drop-shadow-md hf:text-gray-900 hf:drop-shadow"
        type="button"
        onClick={() => setActive((current) => !current)}
      >
        <span className="sr-only">Show Mobile Navigation</span>
        <ChevronDoubleUpIcon className={clsx("h-4 w-4 transition-all", active && "rotate-180")} />
      </button>
      <section className="relative z-10 mt-8 grid grid-cols-2 pb-4">
        <section className="spacing-2">
          <div className="text-[13px] font-medium text-gray-700 d:text-gray-300">Filter view:</div>
          <nav className="flex flex-wrap gap-1.5">
            {(
              [
                "all",
                "relevant",
                "web dev",
                "management",
                "tech support",
                "entrepreneurial",
                "restaurant",
              ] as const
            ).map((type) => (
              <button
                key={type}
                type="button"
                className={clsx(
                  "rounded border  px-1.5 py-0.5 text-xs font-medium outline-none hfa:outline-none ",
                  filter.includes(type)
                    ? "border-sky-300 bg-sky-100 text-gray-700 hf:border-sky-400 hf:bg-sky-300/40 hf:text-gray-800 d:border-sky-700 d:bg-sky-900/60 d:text-gray-200 d:hf:bg-sky-700/50 d:hf:text-gray-100"
                    : "border-gray-200 bg-gray-100 text-gray-400 hf:border-gray-300 hf:bg-gray-200 hf:text-gray-700 d:border-gray-700 d:bg-gray-800 d:text-gray-300 d:hf:border-gray-600 d:hf:bg-gray-700 d:hf:text-gray-100"
                )}
                onClick={() => {
                  selectFilter(type);
                  scrollToY(150, 0);
                }}
              >
                {type}
              </button>
            ))}
          </nav>
        </section>
        <section className="mt-2 justify-end spacing-1">
          <nav className="flex flex-wrap gap-2">
            <Link
              href="mailto:hello@flext.dev"
              target="_blank"
              className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
              data-tip="hello@flext.dev"
            >
              <span className="sr-only">Email me</span>
              <EnvelopeIcon className="h-4 w-4" />
            </Link>
            <Link
              href="https://github.com/FelixTellmann"
              target="_blank"
              data-tip="Github"
              className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
            >
              <span className="sr-only">Github</span>
              <SiGithub className="h-4 w-4" />
            </Link>
            <Link
              href="https://twitter.com/FelixTellmann"
              target="_blank"
              data-tip="Twitter"
              className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
            >
              <span className="sr-only">Twitter</span>
              <SiTwitter className="h-4 w-4" />
            </Link>
            <Link
              href="https://www.linkedin.com/in/felixtellmann"
              target="_blank"
              data-tip="LinkedIn"
              className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
            >
              <span className="sr-only">LinkedIn</span>
              <SiLinkedin className="h-4 w-4" />
            </Link>
          </nav>
          <h5 className="ml-1 text-[13px] text-gray-500 d:text-gray-400">
            Cape Town, South Africa
          </h5>
        </section>
      </section>
    </footer>
  );
};

export const Resume: FC = (props) => {
  const { sections, filter, showSection, selectFilter } = useResumeSectionInView();
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
      <table className="margin-0 padding-0 relative block min-h-screen appearance-none border-none print:!table [&_td]:p-0">
        <thead className=" hidden w-full print:!table-header-group">
          <tr>
            <th className="flex w-[1024px] pb-4 text-left font-normal">
              <header className="">
                <h1 className="text-3xl font-bold tracking-wide">{CV.name}</h1>
                <h2 className="flex gap-1 ">
                  <span className="font-semibold tracking-tight text-gray-500">{CV.title} - </span>
                  {CV.primary_stack.map(({ name, Icon }) => (
                    <span key={name} className="mx-1 flex items-center gap-1 text-sm text-gray-500">
                      <Icon className="h-4 w-4" />
                      {name}
                    </span>
                  ))}
                </h2>
              </header>
              <div className="mt-1 ml-auto mt-auto flex-1 items-end justify-end text-right text-[13px] text-gray-600 spacing-0">
                <div>
                  <Link href={`tel:${CV.mobile.href}`}>{CV.mobile.number}</Link>
                  <span> - </span>
                  <Link href={`mailto:${CV.email}`}>{CV.email}</Link>
                </div>
                <div>
                  <Link href={CV.website}>{CV.website.replace("https://", "")}</Link>
                  <span> - </span>
                  <Link href="https://github.com/FelixTellmann">github.com/FelixTellmann</Link>
                </div>
              </div>
            </th>
          </tr>
        </thead>
        <tfoot className="fixed inset-x-0 bottom-0 hidden w-full text-center print:!table-footer-group">
          <tr>
            <th>
              <small className="absolute left-1/2 bottom-0 -translate-x-1/2 pb-1 pt-3 text-[13px] font-medium tracking-tight text-gray-400">
                View full resume at <Link href="https://flext.dev">www.flext.dev</Link>
              </small>
            </th>
          </tr>
        </tfoot>
        <tbody className="block print:table-row-group print:!h-screen print:!min-h-screen">
          <tr className="block print:!table-row">
            <td className="block print:!table-cell">
              <article className="relative mx-auto mb-16 grid max-w-6xl gap-12 px-4 py-16 print:!flex print:!py-0 print:!pl-24 md:px-8 lg:grid-cols-[1fr_200px] print:[&_*]:![-webkit-print-color-adjust:exact] print:[&_*]:![color-adjust:exact] print:[&_*]:![print-color-adjust:exact]">
                <main className="snap-y snap-normal spacing-10">
                  <ResumeSection title="Intro" className="break-inside-avoid print:!max-w-3xl">
                    <p className="text-[15px] leading-relaxed text-gray-500 d:text-gray-300 d:text-gray-300 print:!-ml-24 print:!max-w-3xl print:!text-base">
                      {CV.intro}
                    </p>
                  </ResumeSection>
                  <figure className="relative -top-2 z-10 ml-2 hidden h-56 w-44 rotate-6 bg-white print:!absolute print:!right-2 print:!top-8 print:!mt-0 print:!inline-block">
                    <div className="absolute -inset-x-10 top-0 h-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
                    <div className="absolute -inset-y-10 right-0 w-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
                    <div className="absolute -inset-x-10 bottom-0 h-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
                    <div className="absolute -inset-y-10 left-0 w-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
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
                        preload
                        className="rounded-sm shadow-xl shadow-sky-400/10"
                        alt="Felix Tellmann Profile Pic"
                        width="176"
                        height="224"
                        pixelDensity={2}
                      />
                    </div>
                  </figure>
                  <ResumeSection title="Experience" className="">
                    <div className="spacing-8">
                      {CV.experience
                        .sort((a, b) => {
                          if (new Date(a.dateFrom) < new Date(b.dateFrom)) return 1;
                          if (new Date(a.dateFrom) > new Date(b.dateFrom)) return -1;
                          return 0;
                        })
                        .filter(({ type }) => type.includes(filter) || filter === "all")
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
                              type,
                            },
                            index,
                            arr
                          ) => {
                            return (
                              <section
                                className="relative mb-auto break-inside-avoid-page"
                                key={index}
                              >
                                <div className="relative flex">
                                  <ResumeSectionDateSidebar
                                    dateFrom={dateFrom}
                                    dateTo={dateTo}
                                    showDateRange
                                    isLast={index === arr.length - 1}
                                  />

                                  <ResumeSectionDateEvents
                                    name={title}
                                    organization={company}
                                    city={city}
                                    country={country}
                                    dateFrom={dateFrom}
                                    dateTo={dateTo}
                                    showDateRange
                                    description={description}
                                    responsibilities={responsibilities}
                                  />
                                </div>
                              </section>
                            );
                          }
                        )}
                    </div>
                  </ResumeSection>
                  <ResumeSection className="break-inside-avoid" title="Education">
                    <div className="spacing-8">
                      {CV.eduction
                        .sort((a, b) => {
                          if (new Date(a.dateFrom) < new Date(b.dateFrom)) return 1;
                          if (new Date(a.dateFrom) > new Date(b.dateFrom)) return -1;
                          return 0;
                        })
                        .filter(({ type }) => type.includes(filter) || filter === "all")
                        .map(
                          (
                            { dateFrom, dateTo, city, country, institution, certificate, level },
                            index,
                            arr
                          ) => {
                            return (
                              <section className="relative flex" key={index}>
                                <ResumeSectionDateSidebar
                                  dateFrom={dateFrom}
                                  dateTo={dateTo}
                                  showDateRange={false}
                                  isLast={index === arr.length - 1}
                                />

                                <ResumeSectionDateEvents
                                  name={certificate}
                                  organization={institution}
                                  city={city}
                                  country={country}
                                  dateFrom={dateFrom}
                                  dateTo={dateTo}
                                  showDateRange={false}
                                  description=""
                                  responsibilities={[]}
                                />
                              </section>
                            );
                          }
                        )}
                    </div>
                  </ResumeSection>
                  <ResumeSection className="break-inside-avoid" title="Capabilities">
                    <div className="spacing-8 print:!-ml-24 print:!spacing-3">
                      <section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                        <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                          <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                            Languages
                          </strong>
                        </h3>
                        <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.capabilities.languages
                            .map((language, index) => language.name)
                            .join(", ")}
                        </p>
                      </section>
                      <section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                        <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                          <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                            Programming Languages
                          </strong>
                        </h3>
                        <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.capabilities.programmingLanguages
                            .map((language, index) => language.name)
                            .join(", ")}
                        </p>
                      </section>
                      <section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                        <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                          <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                            Libraries & Frameworks
                          </strong>
                        </h3>
                        <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.capabilities.librariesFrameworks
                            .map((language, index) => language.name)
                            .join(", ")}
                        </p>
                      </section>
                      <section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                        <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                          <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                            Service Providers
                          </strong>{" "}
                        </h3>
                        <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.capabilities.serviceProviders
                            .map((language, index) => language.name)
                            .join(", ")}
                        </p>
                      </section>
                      <section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                        <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                          <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                            Content Platforms
                          </strong>{" "}
                        </h3>
                        <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.capabilities.dataProviders
                            .map((language, index) => language.name)
                            .join(", ")}
                        </p>
                      </section>
                      <section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                        <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                          <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                            Tools
                          </strong>{" "}
                        </h3>
                        <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.capabilities.tools.map((language, index) => language.name).join(", ")}
                        </p>
                      </section>
                    </div>
                  </ResumeSection>
                  <ResumeSection className="break-inside-avoid" title="Certifications">
                    <div className="spacing-6 print:!-ml-24">
                      <section>
                        <ul className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                          {CV.certifications
                            .sort((a, b) => {
                              if (new Date(a.date) < new Date(b.date)) return 1;
                              if (new Date(a.date) > new Date(b.date)) return -1;
                              return 0;
                            })
                            .filter(({ type }) => type.includes(filter) || filter === "all")
                            .map(({ date, name, type }, index, arr) => (
                              <li className="" key={index}>
                                <span className="inline-flex items-baseline gap-2">
                                  <span className="text-xs font-medium leading-[16px] text-gray-400 d:text-gray-500">
                                    {date}
                                  </span>
                                  <span className="select-none text-sm text-gray-300 print:!text-gray-500">
                                    -
                                  </span>
                                  <span>{name}</span>
                                </span>
                              </li>
                            ))}
                        </ul>
                      </section>

                      {["all", "restaurant"].includes(filter)
                        ? <section className="relative max-w-prose spacing-1">
                            <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                              <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100">
                                Other
                              </strong>{" "}
                            </h3>
                            <ul className="list-outside list-disc pl-4 text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                              {CV.other.map(({ name }, index) => (
                                <li className="pl-3" key={index}>
                                  {name}
                                </li>
                              ))}
                            </ul>
                          </section>
                        : null}
                    </div>
                  </ResumeSection>
                  <ResumeSection className="break-inside-avoid print:!hidden" title="References">
                    <div className="spacing-10">
                      {CV.references.map(({ author, company, title, reference }) => (
                        <figure key={author} className="max-w-prose spacing-2">
                          <blockquote className="text-[15px] leading-relaxed text-gray-500 d:text-gray-300/90">
                            {reference}
                          </blockquote>
                          <figcaption className="">
                            <div className="font-semibold">{author}</div>
                            <div className="text-sm text-gray-400">
                              {title} at {company}
                            </div>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </ResumeSection>
                </main>
                <aside className="top-[144px] mb-auto hidden max-h-min print:!hidden lg:sticky lg:spacing-8">
                  <figure className="relative -top-2 z-0 ml-2 h-48 w-[9.5rem] rotate-6 print:!absolute print:!left-40 print:!top-6">
                    <div className="absolute -inset-x-10 top-0 h-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
                    <div className="absolute -inset-y-10 right-0 w-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
                    <div className="absolute -inset-x-10 bottom-0 h-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
                    <div className="absolute -inset-y-10 left-0 w-0.5 bg-gray-900/[0.1] [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)] d:bg-gray-50/20" />
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
                        preload
                        className="rounded-sm shadow-xl shadow-sky-400/10"
                        alt="Felix Tellmann Profile Pic"
                        width="176"
                        height="224"
                        pixelDensity={2}
                      />
                    </div>
                  </figure>
                  <section className="spacing-6 print:!hidden">
                    <nav className="relative whitespace-nowrap text-[15px] font-medium text-gray-300 spacing-0">
                      <HoverEffect className="border-none border-transparent bg-gray-100" />
                      {Object.keys(sections).map((key) => (
                        <Link
                          key={key}
                          className={clsx(
                            "-ml-2 w-min rounded-md px-2 py-1 outline-none transition-all duration-75 hfa:outline-none",
                            inView === key ? "text-sky-500 hf:text-sky-600" : "hf:text-gray-700"
                          )}
                          onClick={() => showSection(key)}
                          href={`#${key}`}
                        >
                          {capitalize(key)}
                        </Link>
                      ))}
                    </nav>
                  </section>
                  <section className="spacing-2 print:!hidden">
                    <div className="text-[13px] font-medium text-gray-700 d:text-gray-300">
                      Filter view:
                    </div>
                    <nav className="flex flex-wrap gap-1.5">
                      {(
                        [
                          "all",
                          "relevant",
                          "web dev",
                          "management",
                          "tech support",
                          "entrepreneurial",
                          "restaurant",
                        ] as const
                      ).map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={clsx(
                            "rounded border  px-1.5 py-0.5 text-xs font-medium outline-none hfa:outline-none ",
                            filter.includes(type)
                              ? "border-sky-300 bg-sky-100 text-gray-700 hf:border-sky-400 hf:bg-sky-300/40 hf:text-gray-800 d:border-sky-700 d:bg-sky-900/60 d:text-gray-200 d:hf:bg-sky-700/50 d:hf:text-gray-100"
                              : "border-gray-200 bg-gray-100 text-gray-400 hf:border-gray-300 hf:bg-gray-200 hf:text-gray-700 d:border-gray-700 d:bg-gray-800 d:text-gray-300 d:hf:border-gray-600 d:hf:bg-gray-700 d:hf:text-gray-100"
                          )}
                          onClick={() => {
                            selectFilter(type);
                            scrollToY(150, 0);
                          }}
                        >
                          {type}
                        </button>
                      ))}
                    </nav>
                  </section>
                  <section className="mt-2 spacing-1 print:!hidden">
                    {/*<h4 className="text-[13px] font-medium text-gray-700">Contact:</h4>*/}
                    <nav className="flex flex-wrap gap-2">
                      <Link
                        href="mailto:hello@flext.dev"
                        target="_blank"
                        className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
                        data-tip="hello@flext.dev"
                      >
                        <span className="sr-only">Email me</span>
                        <EnvelopeIcon className="h-4 w-4" />
                      </Link>
                      <Link
                        href="https://github.com/FelixTellmann"
                        target="_blank"
                        data-tip="Github"
                        className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
                      >
                        <span className="sr-only">Github</span>
                        <SiGithub className="h-4 w-4" />
                      </Link>
                      <Link
                        href="https://twitter.com/FelixTellmann"
                        target="_blank"
                        data-tip="Twitter"
                        className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
                      >
                        <span className="sr-only">Twitter</span>
                        <SiTwitter className="h-4 w-4" />
                      </Link>
                      <Link
                        href="https://www.linkedin.com/in/felixtellmann"
                        target="_blank"
                        data-tip="LinkedIn"
                        className="rounded p-1 text-gray-400 transition-all duration-75 hf:bg-gray-100 hf:text-gray-700 d:text-gray-300 d:hf:bg-gray-800/80 d:hf:text-gray-200"
                      >
                        <span className="sr-only">LinkedIn</span>
                        <SiLinkedin className="h-4 w-4" />
                      </Link>
                    </nav>
                    <h5 className="ml-1 text-[13px] text-gray-500 d:text-gray-400">
                      Cape Town, South Africa
                    </h5>
                  </section>
                </aside>
                <ResumeFooter />
              </article>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
};

export default Resume;
