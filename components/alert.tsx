import { CheckCircleIcon, ExclamationCircleIcon, InformationCircleIcon, XCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { FC } from "react";

export type AlertProps = {
  show: boolean;
  dismissAlert?: () => void;
  id?: string;
  list?: string[];
  paragraph?: string;
  title?: string;
  type?: "info" | "warning" | "danger" | "attention" | "success";
};

export const Alert: FC<AlertProps> = ({ show, type, dismissAlert, title, paragraph, list }) => {
  if (!show) {
    return <></>;
  }

  switch (type) {
    case "info":
      return (
        <section className="rounded-md bg-green-50 p-4 text-green-800 spacing-1">
          <header className="relative flex items-center">
            <InformationCircleIcon className="mr-3 h-5 w-5 text-green-400" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-medium">{title}</h3>
            <button
              type="button"
              onClick={dismissAlert}
              className="absolute -right-1.5 -top-1.5 inline-flex rounded-md bg-green-50 p-1.5 text-green-500 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 focus:ring-offset-green-50"
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <main className="ml-8 text-sm spacing-1">
            {paragraph ? <p className="text-[13px]">{paragraph}</p> : null}
            {list
              ? <ul role="list" className="list-disc space-y-2 pl-5 text-xs">
                  {list.map((li, i) => (
                    <li key={li + i}>{li}</li>
                  ))}
                </ul>
              : null}
          </main>
        </section>
      );
    case "warning":
      return (
        <section className="rounded-md bg-orange-50 p-4 text-orange-800 spacing-1">
          <header className="relative flex items-center">
            <ExclamationCircleIcon className="mr-3 h-5 w-5 text-orange-400" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-medium">{title}</h3>
            <button
              type="button"
              onClick={dismissAlert}
              className="absolute -right-1.5 -top-1.5 inline-flex rounded-md bg-orange-50 p-1.5 text-orange-500 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-600 focus:ring-offset-2 focus:ring-offset-orange-50"
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <main className="ml-8 text-sm spacing-1">
            {paragraph ? <p className="text-[13px]">{paragraph}</p> : null}
            {list
              ? <ul role="list" className="list-disc space-y-2 pl-5 text-xs">
                  {list.map((li, i) => (
                    <li key={li + i}>{li}</li>
                  ))}
                </ul>
              : null}
          </main>
        </section>
      );
    case "danger":
      return (
        <section className="rounded-md bg-red-50 p-4 text-red-800 spacing-1">
          <header className="relative flex items-center">
            <XCircleIcon className="mr-3 h-5 w-5 text-red-400" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-medium">{title}</h3>
            <button
              type="button"
              onClick={dismissAlert}
              className="absolute -right-1.5 -top-1.5 inline-flex rounded-md bg-red-50 p-1.5 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 focus:ring-offset-red-50"
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <main className="ml-8 text-sm spacing-1">
            {paragraph ? <p className="text-[13px]">{paragraph}</p> : null}
            {list
              ? <ul role="list" className="list-disc space-y-2 pl-5 text-xs">
                  {list.map((li, i) => (
                    <li key={li + i}>{li}</li>
                  ))}
                </ul>
              : null}
          </main>
        </section>
      );
    case "attention":
      return (
        <section className="rounded-md bg-yellow-50 p-4 text-yellow-800 spacing-1">
          <header className="relative flex items-center">
            <ExclamationCircleIcon className="mr-3 h-5 w-5 text-yellow-400" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-medium">{title}</h3>
            <button
              type="button"
              onClick={dismissAlert}
              className="absolute -right-1.5 -top-1.5 inline-flex rounded-md bg-yellow-50 p-1.5 text-yellow-500 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-600 focus:ring-offset-2 focus:ring-offset-yellow-50"
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <main className="ml-8 text-sm spacing-1">
            {paragraph ? <p className="text-[13px]">{paragraph}</p> : null}
            {list
              ? <ul role="list" className="list-disc space-y-2 pl-5 text-xs">
                  {list.map((li, i) => (
                    <li key={li + i}>{li}</li>
                  ))}
                </ul>
              : null}
          </main>
        </section>
      );
    case "success": {
      return (
        <section className="rounded-md bg-green-50 p-4 text-green-800 spacing-1">
          <header className="relative flex items-center">
            <CheckCircleIcon className="mr-3 h-5 w-5 text-green-400" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-medium">{title}</h3>
            <button
              type="button"
              onClick={dismissAlert}
              className="absolute -right-1.5 -top-1.5 inline-flex rounded-md bg-green-50 p-1.5 text-green-500 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 focus:ring-offset-green-50"
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <main className="ml-8 text-sm spacing-1">
            {paragraph ? <p className="text-[13px]">{paragraph}</p> : null}
            {list
              ? <ul role="list" className="list-disc space-y-2 pl-5 text-xs">
                  {list.map((li, i) => (
                    <li key={li + i}>{li}</li>
                  ))}
                </ul>
              : null}
          </main>
        </section>
      );
    }
    default:
      return <></>;
  }
};
