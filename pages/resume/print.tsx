import { FC } from "react";

export const ResumePrint: FC = () => {
  return (
    <article className="[@page:size-[21cm_29.7cm]]">
      <style jsx global>
        {`
          @page {
            size: A4 portrait;
            margin: 10mm 10mm 10mm 10mm;
            /* change the margins as you want them to be. */
          }
        `}
      </style>
      <table className="report-container">
        <thead className="report-header"></thead>
        <tbody className="report-content"></tbody>
        <tfoot className="report-footer"></tfoot>
      </table>
    </article>
  );
};

export default ResumePrint;
