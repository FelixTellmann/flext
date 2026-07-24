import type { FC, ReactNode } from "react";
import { useResumeSectionInView } from "~/components/resume/use-resume-section-in-view";

type ResumeSectionDateEventsProps = {
  name: ReactNode;
  organization?: ReactNode;
  city?: string | undefined;
  country?: string | undefined;
  dateFrom: string | Date;
  dateTo: string | Date;
  showDateRange: boolean;
  description?: ReactNode;
  responsibilities: { type: string[]; content: ReactNode }[];
  bullets?: boolean;
};

export const ResumeSectionDateEvents: FC<ResumeSectionDateEventsProps> = ({
  name,
  organization,
  city,
  country,
  dateFrom,
  dateTo,
  showDateRange,
  description,
  responsibilities,
  bullets = true,
}) => {
  const { filter } = useResumeSectionInView();
  return (
    <main className="spacing-1 print:!ml-12 ml-0 md:ml-24 xl:ml-14 2xl:ml-12">
      <h3 className="spacing-1 items-baseline text-sm tracking-tight">
        <strong className="print:!text-sm print:!text-[18px] print:!font-semibold font-bold d:text-gray-100 text-[17px] text-gray-900">
          {name}
        </strong>{" "}
        <span className="print:!text-[16px] flex flex-wrap items-baseline gap-x-2 gap-y-0">
          {organization ? (
            <>
              <span className="font-semibold d:text-gray-400 text-gray-600">{organization}</span>
              <span className="print:!text-gray-500 select-none text-gray-300 text-sm">-</span>
            </>
          ) : null}
          <span className="print:!text-gray-500 text-gray-400/80">
            {city && country ? (
              <>
                <span className="print:!inline hidden sm:inline">{city},</span> {country}
              </>
            ) : (
              <>
                {city}
                {country}
              </>
            )}
          </span>
        </span>
        <div className="print:!hidden flex gap-2 whitespace-nowrap font-semibold d:text-gray-400 text-gray-500 text-xs md:hidden">
          {showDateRange ? (
            <>
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
          ) : (
            <span>
              {new Date(dateTo)?.toLocaleDateString("en-GB", {
                year: "numeric",
              })}
            </span>
          )}
        </div>
      </h3>
      {description ? <p className="text-gray-600 text-sm leading-relaxed">{description}</p> : null}
      {bullets ? (
        <ul className="print:!text-base list-outside list-disc pl-4 d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400">
          {responsibilities
            .filter(({ type }) => type.includes(filter) || filter === "all")
            .map((responsibility, index) => (
              <li className="pl-3" key={index}>
                {responsibility.content}
              </li>
            ))}
        </ul>
      ) : (
        <>
          {responsibilities
            .filter(({ type }) => type.includes(filter) || filter === "all")
            .map((responsibility, index) => (
              <p
                className="print:!text-base d:text-gray-300/80 text-gray-500 text-sm d:marker:text-gray-600 marker:text-gray-400"
                key={index}
              >
                {responsibility.content}
              </p>
            ))}
        </>
      )}
    </main>
  );
};
