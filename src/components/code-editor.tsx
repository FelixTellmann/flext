import { CopyButton } from "~/components/copy-button";
import type { CodeGroupProps } from "~/components/typography/code";
import { Code } from "~/components/typography/code";

export const CodeEditor = ({ code, language }: { code: string | string[]; language: CodeGroupProps["language"] }) => {
  return (
    <figure className="relative w-full flex-col overflow-hidden rounded-md border-2 border-gray-200/40 d:border-gray-600/40 bg-gray-900 p-2.5 shadow-2xl drop-shadow-lg">
      <header className="mb-2 grid items-center border-b border-b-gray-800 pb-2" style={{ gridTemplateColumns: "50px 1fr 50px" }}>
        <i className="flex gap-1.5">
          <button type="button" tabIndex={-1} aria-hidden className="h-3 w-3 rounded-full bg-gray-700 h:bg-[#EC6A5F] transition-colors" />
          <button type="button" tabIndex={-1} aria-hidden className="h-3 w-3 rounded-full bg-gray-700 h:bg-[#F4BF50] transition-colors" />
          <button type="button" tabIndex={-1} aria-hidden className="h-3 w-3 rounded-full bg-gray-700 h:bg-[#61C454] transition-colors" />
        </i>
        <div className="color select-none text-center text-[13px] text-gray-500 leading-none tracking-wide">/index.tsx</div>
        <div className="flex justify-end">
          <CopyButton content={Array.isArray(code) ? code.join("\n") : code} className="hf:text-white text-gray-500" />
        </div>
      </header>
      <main className="b:pointer-events-none relative b:bottom-0 b:z-10 b:h-12 h-[calc(100%-37px)] b:w-full b:select-none overflow-hidden b:bg-gradient-to-b b:from-transparent b:to-gray-900 before:absolute">
        <div className="sm:scrollbar-none relative h-full overflow-auto">
          <Code className="text-[13px]" code={code} language={language} />
        </div>
      </main>
    </figure>
  );
};
