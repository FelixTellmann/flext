import { ChevronDownIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { ResumeSectionInViewStore, useResumeSectionInView } from "components/resume/use-resume-section-in-view";
import { useInView } from "framer-motion";
import { FC, PropsWithChildren, useEffect, useRef } from "react";
import { useWindowSize } from "react-use";
import { toKebabCase } from "utils/to-kebab-case";

export const ResumeSection: FC<PropsWithChildren<{ title: string; className?: string }>> = ({
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
          "relative transition-all duration-200 ease-linear print:!max-h-max",
          !section.showing && "!max-h-0 overflow-hidden opacity-0"
        )}
      >
        <div className="transition-[all,height] delay-[0s,0.2s]"></div>
        {children}
      </main>
    </section>
  );
};
