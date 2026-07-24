import { ChevronDownIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { useInView } from "framer-motion";
import type { FC, PropsWithChildren } from "react";
import { useEffect, useRef } from "react";
import { useWindowSize } from "react-use";
import { toKebabCase } from "utils/to-kebab-case";
import type { ResumeSectionInViewStore } from "~/components/resume/use-resume-section-in-view";
import { useResumeSectionInView } from "~/components/resume/use-resume-section-in-view";

export const ResumeSection: FC<PropsWithChildren<{ title: string; className?: string }>> = ({ title, children, className = "" }) => {
  const sectionContentRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const centerVisible = useInView(sectionRef, { margin: "-45% 0px -25% 0px" });
  const fullyVisible = useInView(sectionRef, { amount: 0.9 });
  const { width } = useWindowSize();
  const { sections, filter, updateSection, toggleSectionShowing, showSection } = useResumeSectionInView();
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
      setTimeout(() => {
        element.style.maxHeight = "";
      }, 160);
      setTimeout(() => {
        element.style.maxHeight = element.clientHeight !== 0 ? `${element!.clientHeight}px` : "";
      }, 500);
    }
  }, [key, section.showing, sections]);

  useEffect(() => {
    const element = sectionContentRef.current;
    if (element && !element.classList.contains("!max-h-0") && element.style.maxHeight) {
      element.style.maxHeight = "";
    }
  }, [width, filter]);

  useEffect(() => {
    updateSection(toKebabCase(title) as keyof ResumeSectionInViewStore["sections"], section.showing, centerVisible, fullyVisible);
  }, [centerVisible, fullyVisible, section.showing, title, updateSection]);

  return (
    <section
      id={toKebabCase(title)}
      className={clsx(
        "spacing-4 print:!overflow-visible relative -mx-4 scroll-mt-[122px] overflow-hidden px-4 md:overflow-visible",
        className,
      )}
      ref={sectionRef}
    >
      <header className="spacing-3 print:!-ml-24">
        <h2 className="flex items-baseline">
          <button
            type="button"
            className="print:!flex-1 print:!text-xl flex items-baseline text-left font-bold d:text-gray-100 text-3xl text-gray-800 tracking-tight"
            onClick={() => showSection(key)}
          >
            <span className="min-w-[105px]">{title}</span>
            <hr className="print:!flex-1 mr-24 ml-6 hidden border-gray-400 border-dashed print:block" />
          </button>
          <button
            type="button"
            className="group print:!hidden mr-2 ml-auto rounded hf:bg-gray-100 p-2 hf:text-gray-900 text-gray-400/90 hfa:outline-none transition-colors"
            onClick={() => toggleSectionShowing(key)}
          >
            <span className="sr-only">Toggle Section Visibility</span>
            <ChevronDownIcon className={clsx("h-4 w-4 transition-all", section.showing ? "" : "rotate-180")} />
          </button>
        </h2>
        <hr className="print:!hidden h-px border-none bg-[length:8px_1px] bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] [--line-color:theme(colors.gray.300/40)] d:[--line-color:theme(colors.gray.700/20)]" />
      </header>
      <main
        ref={sectionContentRef}
        className={clsx(
          "print:!max-h-max relative transition-all duration-200 ease-linear",
          !section.showing && "!max-h-0 overflow-hidden opacity-0",
        )}
      >
        <div className="transition-[all,height] delay-[0s,0.2s]" />
        {children}
      </main>
    </section>
  );
};
