import { useResumeSectionInView } from "components/resume/use-resume-section-in-view";

export const ResumeSectionDateEvents = ({
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
    <main className="ml-0 spacing-1 print:!ml-12 md:ml-24 xl:ml-14 2xl:ml-12">
      <h3 className="items-baseline text-sm tracking-tight spacing-1 ">
        <strong className="text-[17px] font-bold text-gray-900 d:text-gray-100 print:!text-sm print:!text-[18px] print:!font-semibold">
          {name}
        </strong>{" "}
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0 print:!text-[16px]">
          {organization
            ? <>
                <span className="font-semibold text-gray-600 d:text-gray-400">{organization}</span>
                <span className="select-none text-sm text-gray-300 print:!text-gray-500">-</span>
              </>
            : null}
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
      {bullets
        ? <ul className="list-outside list-disc pl-4 text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600 print:!text-base">
            {responsibilities
              .filter(({ type }) => type.includes(filter) || filter === "all")
              .map((responsibility, index) => (
                <li className="pl-3" key={index}>
                  {responsibility.content}
                </li>
              ))}
          </ul>
        : <>
            {responsibilities
              .filter(({ type }) => type.includes(filter) || filter === "all")
              .map((responsibility, index) => (
                <p
                  className=" text-sm text-gray-500 marker:text-gray-400 d:text-gray-300/80 d:marker:text-gray-600 print:!text-base"
                  key={index}
                >
                  {responsibility.content}
                </p>
              ))}
          </>}
    </main>
  );
};
