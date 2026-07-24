import { EnvelopeIcon } from "@heroicons/react/24/solid";
import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { SiLinkedin } from "@react-icons/all-files/si/SiLinkedin";
import { SiTwitter } from "@react-icons/all-files/si/SiTwitter";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { CV } from "content/liz-cv";
import { Image } from "~/components/image";
import { HoverEffect } from "~/components/layout/header.desktop-nav.hover-effect";
import { Link } from "~/components/link";
import { ResumeFooter } from "~/components/resume/resume-mobile-footer";
import { ResumeSection } from "~/components/resume/resume-section";
import { ResumeSectionDateSidebar } from "~/components/resume/resume-section-data-sidebar";
import { ResumeSectionDateEvents } from "~/components/resume/resume-section-date-events";
import { useResumeSectionInView } from "~/components/resume/use-resume-section-in-view";

const LizProfilePic = "/images/about/liz.jpg";

import { type FC, useEffect, useState } from "react";
import { capitalize } from "utils/capitalize";
import { scrollToY } from "utils/scroll-to";

export const Route = createFileRoute("/liz")({
  component: LizPage,
});

function LizPage() {
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
    <table className="margin-0 padding-0 print:!table relative block min-h-screen appearance-none border-none text-gray-900 [&_td]:p-0">
      <thead className="print:!table-header-group hidden w-full">
        <tr>
          <th className="flex w-[1024px] pb-4 text-left font-normal">
            <header className="">
              <h1 className="font-bold text-4xl tracking-tight">{CV?.name}</h1>
              <h2 className="flex gap-1">
                <span className="font-semibold text-gray-500 tracking-tight">{CV?.title} - </span>
                {CV?.primary_stack.map(({ name, Icon }) => (
                  <span key={name} className="mx-1 flex items-center gap-1 text-gray-500">
                    <Icon className="h-4 w-4" />
                    {name}
                  </span>
                ))}
              </h2>
            </header>
            <div className="spacing-0 mt-1 ml-auto flex-1 items-end justify-end text-right text-[15px] text-gray-500">
              <div>
                <Link href={`tel:${CV?.mobile.href}`}>{CV?.mobile.number}</Link>
                <span> - </span>
                <Link href={`mailto:${CV?.email}`}>{CV?.email}</Link>
              </div>
              <div>
                {/*<Link href={CV?.website}>{CV?.website.replace("https://", "")}</Link>*/}
                {/*<span> - </span>*/}
                {/*<Link href="https://github.com/FelixTellmann">github.com/FelixTellmann</Link>*/}
              </div>
            </div>
          </th>
        </tr>
      </thead>
      {/*<tfoot className="fixed inset-x-0 bottom-0 hidden w-full text-center print:!table-footer-group">
        <tr>
          <th>
            <small className="absolute left-1/2 bottom-0 -translate-x-1/2 pb-1 pt-3 text-[13px] font-medium tracking-tight text-gray-400">
              View full resume at <Link href="https://flext.dev">www.flext.dev</Link>
            </small>
          </th>
        </tr>
      </tfoot>*/}
      <tbody className="print:!h-screen print:!min-h-screen block print:table-row-group">
        <tr className="print:!table-row block">
          <td className="print:!table-cell block">
            <article className="print:!flex print:!py-0 print:!pl-24 print:[&_*]:![-webkit-print-color-adjust:exact] print:[&_*]:![print-color-adjust:exact] relative mx-auto mb-16 grid max-w-6xl gap-12 px-4 py-16 md:px-8 lg:grid-cols-[1fr_200px]">
              <main className="spacing-10 snap-y snap-normal">
                <ResumeSection title="Intro" className="print:!max-w-3xl break-inside-avoid">
                  <p className="print:!-ml-24 print:!max-w-3xl print:!text-base d:text-gray-300 text-[15px] text-gray-500 leading-relaxed">
                    {CV?.intro}
                  </p>
                </ResumeSection>
                <figure className="print:!absolute print:!right-2 print:!top-8 print:!mt-0 print:!inline-block relative -top-2 z-10 ml-2 hidden h-56 w-44 rotate-6 bg-white">
                  <div className="absolute -inset-x-10 top-0 h-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute -inset-y-10 right-0 w-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute -inset-x-10 bottom-0 h-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute -inset-y-10 left-0 w-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute right-0 bottom-full -mb-px flex h-8 items-end overflow-hidden">
                    <div className="-mb-px flex h-[2px] w-44 -scale-x-100">
                      <div className="w-full flex-none blur-sm [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                      <div className="-ml-[100%] w-full flex-none blur-[1px] [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                    </div>
                  </div>
                  <div className="absolute top-[calc(100%-1px)] left-2 -mb-px flex h-8 items-start overflow-hidden">
                    <div className="-mt-px flex h-[2px] w-44 -scale-x-100">
                      <div className="w-full flex-none blur-sm [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                      <div className="-ml-[100%] w-full flex-none blur-[1px] [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                    </div>
                  </div>
                  <div className="flex h-full items-center justify-center px-2">
                    <Image
                      src={LizProfilePic}
                      preload
                      className="rounded-sm shadow-sky-400/10 shadow-xl"
                      alt="Felix Tellmann Profile Pic"
                      width="176"
                      height="224"
                      pixelDensity={2}
                    />
                  </div>
                </figure>
                <ResumeSection
                  title="Experience"
                  className={clsx(
                    "break-inside-avoid",
                    !CV.experience.filter(({ type }) => type.includes(filter) || filter === "all").length && "!hidden",
                  )}
                >
                  <div className="spacing-8">
                    {CV?.experience
                      .sort((a, b) => {
                        if (new Date(a.dateTo) < new Date(b.dateTo)) return 1;
                        if (new Date(a.dateTo) > new Date(b.dateTo)) return -1;
                        return 0;
                      })
                      .filter(({ type }) => type.includes(filter) || filter === "all")
                      .map(({ dateFrom, dateTo, city, country, title, responsibilities, company, description, type }, index, arr) => {
                        return (
                          <section className="relative mb-auto break-inside-avoid-page" key={index}>
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
                      })}
                  </div>
                </ResumeSection>
                <ResumeSection
                  title="Projects"
                  className={clsx(
                    "break-inside-avoid",
                    !CV.projects.filter(({ type }) => type.includes(filter) || filter === "all").length && "!hidden",
                  )}
                >
                  <div className="spacing-8 print:spacing-6">
                    {CV?.projects
                      .sort((a, b) => {
                        if (new Date(a.dateFrom) < new Date(b.dateFrom)) return 1;
                        if (new Date(a.dateFrom) > new Date(b.dateFrom)) return -1;
                        return 0;
                      })
                      .filter(({ type }) => type.includes(filter) || filter === "all")
                      .map(({ dateFrom, dateTo, title, responsibilities, sidebar, description, type }, index, arr) => {
                        return (
                          <section className="relative mb-auto break-inside-avoid-page" key={index}>
                            <div className="relative flex">
                              <ResumeSectionDateSidebar
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                                showDateRange
                                isLast={index === arr.length - 1}
                                sidebar={sidebar}
                              />

                              <ResumeSectionDateEvents
                                name={title}
                                organization={undefined}
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                                showDateRange
                                description={description}
                                responsibilities={responsibilities}
                                city={undefined}
                                country={undefined}
                                bullets={false}
                              />
                            </div>
                          </section>
                        );
                      })}
                  </div>
                </ResumeSection>
                <ResumeSection
                  className={clsx(
                    "break-inside-avoid",
                    !CV.eduction.filter(({ type }) => type.includes(filter) || filter === "all").length && "!hidden",
                  )}
                  title="Education"
                >
                  <div className="spacing-4">
                    {CV?.eduction
                      .sort((a, b) => {
                        if (new Date(a.dateFrom) < new Date(b.dateFrom)) return 1;
                        if (new Date(a.dateFrom) > new Date(b.dateFrom)) return -1;
                        return 0;
                      })
                      .filter(({ type }) => type.includes(filter) || filter === "all")
                      .map(({ dateFrom, dateTo, city, country, institution, certificate, level }, index, arr) => {
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
                      })}
                  </div>
                </ResumeSection>
                <ResumeSection className="break-inside-avoid" title="Capabilities">
                  <div className="spacing-8 print:!-ml-24 print:!spacing-2">
                    {/*<section className="relative max-w-prose spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr]">
                      <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                        <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!font-semibold ">
                          Languages
                        </strong>
                      </h3>
                      <p className="text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600 print:!mt-0">
                        {CV?.capabilities?.languages
                          .map((language, index) => language.name)
                          .join(", ")}
                      </p>
                    </section>*/}
                    <section className="spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr] relative max-w-prose">
                      <h3 className="spacing-1 items-baseline text-sm tracking-tight">
                        <strong className="print:!text-sm print:!font-semibold font-bold d:text-gray-100 text-[17px] text-gray-900">
                          Design
                        </strong>
                      </h3>
                      <p className="print:!mt-0 d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
                        {CV?.capabilities?.design.map((language, index) => language.name).join(", ")}
                      </p>
                    </section>
                    <section className="spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr] relative max-w-prose">
                      <h3 className="spacing-1 items-baseline text-sm tracking-tight">
                        <strong className="print:!text-sm print:!font-semibold font-bold d:text-gray-100 text-[17px] text-gray-900">
                          Marketing
                        </strong>{" "}
                      </h3>
                      <p className="print:!mt-0 d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
                        {CV?.capabilities?.marketing.map((language, index) => language.name).join(", ")}
                      </p>
                    </section>
                    <section className="spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr] relative max-w-prose">
                      <h3 className="spacing-1 items-baseline text-sm tracking-tight">
                        <strong className="print:!text-sm print:!font-semibold font-bold d:text-gray-100 text-[17px] text-gray-900">
                          Content Platforms
                        </strong>{" "}
                      </h3>
                      <p className="print:!mt-0 d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
                        {CV?.capabilities?.dataProviders.map((language, index) => language.name).join(", ")}
                      </p>
                    </section>
                    <section className="spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr] relative max-w-prose">
                      <h3 className="spacing-1 items-baseline text-sm tracking-tight">
                        <strong className="print:!text-sm print:!font-semibold font-bold d:text-gray-100 text-[17px] text-gray-900">
                          Programming
                        </strong>
                      </h3>
                      <p className="print:!mt-0 d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
                        {CV?.capabilities?.programmingLanguages.map((language, index) => language.name).join(", ")}
                      </p>
                    </section>
                    <section className="spacing-1 print:!grid print:!max-w-3xl print:!grid-cols-[140px_1fr] relative max-w-prose">
                      <h3 className="spacing-1 items-baseline text-sm tracking-tight">
                        <strong className="print:!text-sm print:!font-semibold font-bold d:text-gray-100 text-[17px] text-gray-900">
                          Tools & Admin
                        </strong>{" "}
                      </h3>
                      <p className="print:!mt-0 d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
                        {CV?.capabilities?.tools.map((language, index) => language.name).join(", ")}
                      </p>
                    </section>
                  </div>
                </ResumeSection>
                <ResumeSection
                  className={clsx(
                    "print:!mt-6 break-inside-avoid",
                    !CV.certifications.filter(({ type }) => type.includes(filter) || filter === "all").length && "!hidden",
                  )}
                  title="Certifications"
                >
                  <div className="spacing-6 print:!-ml-24">
                    <section>
                      <ul className="d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
                        {CV?.certifications
                          .sort((a, b) => {
                            if (new Date(a.date) < new Date(b.date)) return 1;
                            if (new Date(a.date) > new Date(b.date)) return -1;
                            return 0;
                          })
                          .filter(({ type }) => type.includes(filter) || filter === "all")
                          .map(({ date, name, type }, index, arr) => (
                            <li className="" key={index}>
                              <span className="inline-flex items-baseline gap-2">
                                <span className="print:!text-sm font-medium d:text-gray-500 text-gray-400 text-xs leading-[16px]">
                                  {date}
                                </span>
                                <span className="print:!text-gray-500 select-none text-gray-300 text-sm">-</span>
                                <span className="print:!text-base">{name}</span>
                              </span>
                            </li>
                          ))}
                      </ul>
                    </section>

                    {/*{["all", "restaurant"].includes(filter)
                      ? <section className="relative max-w-prose spacing-1">
                          <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
                            <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100">
                              Other
                            </strong>{" "}
                          </h3>
                          <ul className="list-outside list-disc pl-4 text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600">
                            {CV?.other.map(({ name }, index) => (
                              <li className="pl-3" key={index}>
                                {name}
                              </li>
                            ))}
                          </ul>
                        </section>
                      : null}*/}
                  </div>
                </ResumeSection>

                <ResumeSection className="print:!hidden break-inside-avoid" title="References">
                  <div className="spacing-10">
                    {CV?.references.map(({ author, company, title, reference }) => (
                      <figure key={author} className="spacing-2 max-w-prose">
                        <blockquote className="d:text-gray-300/90 text-[15px] text-gray-500 leading-relaxed">{reference}</blockquote>
                        <figcaption className="">
                          <div className="font-semibold">{author}</div>
                          <div className="text-gray-400 text-sm">
                            {title} at {company}
                          </div>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </ResumeSection>
                <ResumeSection title="Interests" className="print:!hidden break-inside-avoid">
                  <p className="print:!-ml-24 print:!text-base d:text-gray-300 d:text-gray-300 text-[15px] text-gray-500 leading-relaxed">
                    {CV?.personal}
                  </p>
                  <div className="h-24" />
                </ResumeSection>
              </main>
              <aside className="print:!hidden lg:spacing-8 top-[144px] mb-auto hidden max-h-min lg:sticky">
                <figure className="print:!absolute print:!left-40 print:!top-6 relative -top-2 z-0 ml-2 h-48 w-[9.5rem] rotate-6">
                  <div className="absolute -inset-x-10 top-0 h-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute -inset-y-10 right-0 w-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute -inset-x-10 bottom-0 h-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_right,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute -inset-y-10 left-0 w-0.5 bg-gray-900/[0.1] d:bg-gray-50/20 [mask-image:linear-gradient(to_top,transparent,white_4rem,white_calc(100%-4rem),transparent)]" />
                  <div className="absolute right-0 bottom-full -mb-px flex h-8 items-end overflow-hidden">
                    <div className="-mb-px flex h-[2px] w-44 -scale-x-100">
                      <div className="w-full flex-none blur-sm [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                      <div className="-ml-[100%] w-full flex-none blur-[1px] [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                    </div>
                  </div>
                  <div className="absolute top-[calc(100%-1px)] left-2 -mb-px flex h-8 items-start overflow-hidden">
                    <div className="-mt-px flex h-[2px] w-44 -scale-x-100">
                      <div className="w-full flex-none blur-sm [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                      <div className="-ml-[100%] w-full flex-none blur-[1px] [background-image:linear-gradient(90deg,rgba(56,189,248,0)_0%,#0EA5E9_32.29%,rgba(236,72,153,0.3)_67.19%,rgba(236,72,153,0)_100%)]" />
                    </div>
                  </div>
                  <div className="flex h-full items-center justify-center px-2">
                    <Image
                      src={LizProfilePic}
                      preload
                      className="rounded-sm shadow-sky-400/10 shadow-xl"
                      alt="Felix Tellmann Profile Pic"
                      width="176"
                      height="224"
                      pixelDensity={2}
                    />
                  </div>
                </figure>
                <section className="spacing-6 print:!hidden">
                  <nav className="spacing-0 relative whitespace-nowrap font-medium text-[15px] text-gray-300">
                    <HoverEffect className="border-transparent border-none bg-gray-100" />
                    {Object.keys(sections).map((key) => (
                      <Link
                        key={key}
                        className={clsx(
                          "-ml-2 w-min rounded-md px-2 py-1 hfa:outline-none outline-none transition-all duration-75",
                          inView === key ? "hf:text-sky-600 text-sky-500" : "hf:text-gray-700",
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
                  <div className="font-medium d:text-gray-300 text-[13px] text-gray-700">Filter view:</div>
                  <nav className="flex flex-wrap gap-1.5">
                    {(
                      [
                        "all",
                        "relevant",
                        "web / tech dev",
                        "management",
                        // "tech support",
                        "entrepreneurial",
                        "restaurant",
                      ] as const
                    ).map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={clsx(
                          "rounded border px-1.5 py-0.5 font-medium text-xs hfa:outline-none outline-none",
                          filter.includes(type)
                            ? "border-sky-300 d:border-sky-700 hf:border-sky-400 bg-sky-100 d:bg-sky-900/60 d:hf:bg-sky-700/50 hf:bg-sky-300/40 d:hf:text-gray-100 d:text-gray-200 hf:text-gray-800 text-gray-700"
                            : "border-gray-200 d:border-gray-700 d:hf:border-gray-600 hf:border-gray-300 bg-gray-100 d:bg-gray-800 d:hf:bg-gray-700 hf:bg-gray-200 d:hf:text-gray-100 d:text-gray-300 hf:text-gray-700 text-gray-400",
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
                <section className="spacing-1 print:!hidden mt-2">
                  {/*<h4 className="text-[13px] font-medium text-gray-700">Contact:</h4>*/}
                  <nav className="flex flex-wrap gap-2">
                    <Link
                      href="mailto:hello@flext.dev"
                      target="_blank"
                      className="rounded d:hf:bg-gray-800/80 hf:bg-gray-100 p-1 d:hf:text-gray-200 d:text-gray-300 hf:text-gray-700 text-gray-400 transition-all duration-75"
                      data-tip="hello@flext.dev"
                    >
                      <span className="sr-only">Email me</span>
                      <EnvelopeIcon className="h-4 w-4" />
                    </Link>
                    <Link
                      href="https://github.com/FelixTellmann"
                      target="_blank"
                      data-tip="Github"
                      className="rounded d:hf:bg-gray-800/80 hf:bg-gray-100 p-1 d:hf:text-gray-200 d:text-gray-300 hf:text-gray-700 text-gray-400 transition-all duration-75"
                    >
                      <span className="sr-only">Github</span>
                      <SiGithub className="h-4 w-4" />
                    </Link>
                    <Link
                      href="https://twitter.com/FelixTellmann"
                      target="_blank"
                      data-tip="Twitter"
                      className="rounded d:hf:bg-gray-800/80 hf:bg-gray-100 p-1 d:hf:text-gray-200 d:text-gray-300 hf:text-gray-700 text-gray-400 transition-all duration-75"
                    >
                      <span className="sr-only">Twitter</span>
                      <SiTwitter className="h-4 w-4" />
                    </Link>
                    <Link
                      href="https://www.linkedin.com/in/felixtellmann"
                      target="_blank"
                      data-tip="LinkedIn"
                      className="rounded d:hf:bg-gray-800/80 hf:bg-gray-100 p-1 d:hf:text-gray-200 d:text-gray-300 hf:text-gray-700 text-gray-400 transition-all duration-75"
                    >
                      <span className="sr-only">LinkedIn</span>
                      <SiLinkedin className="h-4 w-4" />
                    </Link>
                  </nav>
                  <h5 className="ml-1 d:text-gray-400 text-[13px] text-gray-500">Cape Town, South Africa</h5>
                </section>
              </aside>
              <ResumeFooter />
            </article>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
