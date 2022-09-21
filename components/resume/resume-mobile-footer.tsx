import { ChevronDoubleUpIcon, EnvelopeIcon } from "@heroicons/react/24/solid";
import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { SiLinkedin } from "@react-icons/all-files/si/SiLinkedin";
import { SiTwitter } from "@react-icons/all-files/si/SiTwitter";
import { Link } from "components/link";
import clsx from "clsx";
import { useResumeSectionInView } from "components/resume/use-resume-section-in-view";
import { useState } from "react";
import { scrollToY } from "utils/scroll-to";

export const ResumeFooter = () => {
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
