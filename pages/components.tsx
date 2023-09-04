import { Bars2Icon, Bars3BottomLeftIcon } from "@heroicons/react/24/solid";
import { Link } from "components/link";
import { FC } from "react";

type ComponentsProps = {};

export const Components: FC<ComponentsProps> = (props) => {
  return (
    <main className="min-h-screen bg-gray-900 text-gray-200">
      <div className="relative mx-auto flex max-w-8xl gap-8 px-4 pt-20 sm:px-6 lg:px-8">
        <aside className="w-64">
          <nav className="sticky top-20 spacing-1">
            <h3 className="mb-4 font-semibold tracking-tight text-gray-200">
              <span className="inline-flex select-none border-b-2 border-b-gray-400 pb-2 pr-4">
                Global Components
              </span>
            </h3>
            <Link
              href="/components/headings"
              className="group flex items-center gap-3 whitespace-nowrap py-1"
            >
              <figure className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-orange-400 to-pink-500">
                <Bars2Icon className="h-5 w-5 text-white" />
              </figure>
              <span className="text-sm font-medium text-gray-400 transition-colors duration-100 group-hover:text-white">
                Headings
              </span>
            </Link>
            <Link
              href="/components/headings"
              className="group flex items-center gap-3 whitespace-nowrap py-1"
            >
              <figure className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-green-500 to-emerald-500">
                <Bars3BottomLeftIcon className="h-5 w-5 text-white" />
              </figure>
              <span className="text-sm font-medium text-gray-400 transition-colors duration-100 group-hover:text-white">
                Paragraphs
              </span>
            </Link>
          </nav>
        </aside>
        <article className="h-[200vh] flex-1">main content</article>
        <aside className="w-64">
          <nav className="sticky top-20">asd</nav>
        </aside>
      </div>
    </main>
  );
};

export default Components;
