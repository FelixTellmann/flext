import clsx from "clsx";
import { TIMELINEOBJECT } from "content/timeline";
import { FC, useEffect, useRef, useState } from "react";
import { scrollToX } from "utils/scroll-to";

type TimelineProps = {};

export const Timeline: FC<TimelineProps> = ({}) => {
  const [selected, setSelected] = useState("");
  const [initiated, setInitiated] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initiated) {
      const container = scrollContainerRef.current as HTMLDivElement;
      setTimeout(
        () => {
          scrollToX(100, container.scrollWidth, container);
          const year = Object.keys(TIMELINEOBJECT)[Object.keys(TIMELINEOBJECT).length - 1];
          const index = TIMELINEOBJECT[year].length - 1;
          setInitiated(true);
          setSelected(`${year}-${index}`);
        },
        50
      );
    }
  }, [initiated]);

  return (
    <section className="mx-auto  max-w-6xl px-4 pb-16 md:px-8">
      <div className="-mx-4 flex h-96 overflow-x-auto py-4 px-6 xl:mx-0" ref={scrollContainerRef}>
        {Object.entries(TIMELINEOBJECT).map(([year, events], yearIndex, years) => (
          <div key={year} className="relative">
            <header className="absolute left-0 -translate-x-1/2 text-xs font-semibold text-gray-400">
              {year}
            </header>
            <div
              className="mt-6 grid"
              style={{ gridTemplateColumns: `repeat(${events.length}, 120px)` }}
            >
              {events.map(({ heading, Icon, description }, index) => {
                return (
                  <section
                    key={heading}
                    className={clsx("relative", selected === `${year}-${index}` && "selected")}
                  >
                    <button
                      className="absolute flex -translate-x-1/2 flex-col items-center px-3 hfa:outline-none"
                      onMouseOver={() => setSelected(`${year}-${index}`)}
                      onPointerOver={() => setSelected(`${year}-${index}`)}
                      onFocus={() => setSelected(`${year}-${index}`)}
                      onClick={() => setSelected(`${year}-${index}`)}
                    >
                      <div className="h-8 w-0.5 bg-gray-500 transition-all selected:h-[80px] selected:bg-sky-500"></div>
                      <Icon className="mt-2 h-5 w-5 text-gray-500 transition-all d:text-gray-400 selected:text-gray-900 d:selected:text-white" />
                    </button>
                    <div className="absolute top-0 left-px h-2.5 w-[119px] bg-[image:linear-gradient(90deg,transparent_0px,transparent_9px,var(--line-color)_10px,var(--line-color)_10px)] bg-[length:10px_10px] [--line-color:theme(colors.gray.500)]"></div>
                    <main
                      className={clsx(
                        "relative mt-32 w-[17rem] opacity-0 transition-opacity selected:opacity-100",
                        yearIndex === 0 && index === 0 ? "" : "-translate-x-1/2 text-center"
                      )}
                    >
                      <h3 className="whitespace-nowrap font-semibold tracking-tight text-gray-800 d:text-gray-100">
                        {heading}
                      </h3>
                      <p className="text-[15px] font-medium leading-relaxed tracking-tight text-gray-500">
                        {description}
                      </p>
                    </main>
                  </section>
                );
              })}
            </div>
          </div>
        ))}

        <div className="relative">
          <header className="absolute left-0 -translate-x-1/2 text-xs font-semibold text-gray-400">
            Today
          </header>
          <div className="mt-6">
            <section className="relative">
              <div className="h-8 w-0.5 bg-gray-500 pb-4"></div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
};
