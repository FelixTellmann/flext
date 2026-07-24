import { Bars2Icon, Bars3BottomLeftIcon } from "@heroicons/react/24/solid";
import { createFileRoute } from "@tanstack/react-router";
import type { FC } from "react";
import { Link } from "~/components/link";

export const Route = createFileRoute("/components")({
  component: ComponentsPage,
});

function ComponentsPage() {
  return (
    <main className="min-h-screen bg-gray-900 text-gray-200">
      <div className="relative mx-auto flex max-w-8xl gap-8 px-4 pt-20 sm:px-6 lg:px-8">
        <aside className="w-64">
          <nav className="spacing-1 sticky top-20">
            <h3 className="mb-4 font-semibold text-gray-200 tracking-tight">
              <span className="inline-flex select-none border-b-2 border-b-gray-400 pr-4 pb-2">Global Components</span>
            </h3>
            <Link href="/components/headings" className="group flex items-center gap-3 whitespace-nowrap py-1">
              <figure className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-orange-400 to-pink-500">
                <Bars2Icon className="h-5 w-5 text-white" />
              </figure>
              <span className="font-medium text-gray-400 text-sm transition-colors duration-100 group-hover:text-white">Headings</span>
            </Link>
            <Link href="/components/headings" className="group flex items-center gap-3 whitespace-nowrap py-1">
              <figure className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-green-500 to-cyan-500">
                <Bars3BottomLeftIcon className="h-5 w-5 text-white" />
              </figure>
              <span className="font-medium text-gray-400 text-sm transition-colors duration-100 group-hover:text-white">Paragraphs</span>
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
}
