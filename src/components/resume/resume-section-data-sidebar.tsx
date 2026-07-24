import clsx from "clsx";
import type { FC, ReactElement } from "react";

type ResumeSectionDateSidebarProps = {
  dateFrom: string | Date;
  dateTo: string | Date;
  isLast: boolean;
  showDateRange: boolean;
  sidebar?: string | ReactElement;
};
export const ResumeSectionDateSidebar: FC<ResumeSectionDateSidebarProps> = ({ dateFrom, dateTo, isLast, showDateRange, sidebar = "" }) => {
  return (
    <aside className="print:!left-4 print:!block absolute top-1 left-[4.5rem] hidden h-full md:block xl:left-6 2xl:left-4">
      <h3 className="print:!pr-8 print:!text-sm print:!text-gray-600 absolute top-0 right-full pr-6 text-right font-medium text-gray-400 text-xs leading-[16px] xl:pr-8">
        {sidebar ? (
          <span className="whitespace-nowrap">{sidebar}</span>
        ) : (
          <>
            {showDateRange ? (
              <div className="spacing-1">
                <div className="print:!mr-0 whitespace-nowrap xl:mr-2">
                  {new Date(dateFrom)?.toLocaleDateString("en-GB", {
                    month: "short",
                    year: "numeric",
                  })}
                  <span className="print:!inline hidden xl:inline"> -</span>
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
            ) : (
              <span className="whitespace-nowrap">
                {new Date(dateTo)?.toLocaleDateString("en-GB", {
                  year: "numeric",
                })}
              </span>
            )}
          </>
        )}
      </h3>
      <div className="absolute top-0 left-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-gray-200 d:bg-gray-400">
        <div className="h-2 w-2 rounded-full bg-gray-400 d:bg-gray-700" />
      </div>
      <i
        className={clsx(
          "absolute top-6 left-0 h-[calc(100%-2px)] w-0.5 -translate-x-1/2",
          isLast ? "print:!via-gray-200 bg-gradient-to-b d:from-gray-800 from-gray-200 to-transparent" : "bg-gray-200 d:bg-gray-800",
        )}
      />
    </aside>
  );
};
