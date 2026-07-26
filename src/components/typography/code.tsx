import clsx from "clsx";
import Prism from "prismjs";
// No Prism theme stylesheet here on purpose: the site's own theme lives in src/styles/prism.css
// (loaded via tailwind.css). Importing one also drags in its sizing — font-size: 1em, line-height:
// 1.5, padding: 1em, margin: .5em 0 — which overrides the caller's text size and clips the editor.
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-rust";

import { type FC, Fragment, useEffect, useRef } from "react";

export type CodeGroupProps = {
  code: string | string[];
  language: "js" | "css" | "json" | "jsx" | "typescript" | "tsx" | "yml" | "Rust" | "bash" | "html" | "javascript";
  className?: string;
  lineHighlight?: string;
  plugins?: ("line-numbers" | "highlight-keywords")[];
};

const languageMap: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  typescript: "typescript",
  tsx: "tsx",
  css: "css",
  json: "json",
  bash: "bash",
  html: "markup",
  yml: "yaml",
  Rust: "rust",
  javascript: "javascript",
};

export const Code: FC<CodeGroupProps> = ({ language, plugins, lineHighlight, code, className }) => {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) {
      Prism.highlightAllUnder(preRef.current);
    }
  }, [language, code]);

  const prismLang = languageMap[language] ?? language;

  return (
    <pre
      ref={preRef}
      className={clsx(plugins, lineHighlight && "line-highlight", `language-${prismLang}`, className)}
      data-line={lineHighlight}
      tabIndex={-1}
    >
      {(Array.isArray(code) ? code : [code]).map((codeBlock, index) => {
        return (
          <Fragment key={index}>
            <code className={`language-${prismLang}`} data-selected-index={index}>
              {codeBlock}
            </code>
            {"\n"}
          </Fragment>
        );
      })}
    </pre>
  );
};
