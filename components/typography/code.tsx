import clsx from "clsx";
import { highlightAll } from "prismjs";

import { FC, Fragment, useCallback, useEffect } from "react";

export type CodeGroupProps = {
  code: string | string[];
  language:
    | "js"
    | "css"
    | "json"
    | "jsx"
    | "typescript"
    | "tsx"
    | "yml"
    | "Rust"
    | "bash"
    | "html"
    | "javascript";
  className?: string;
  lineHighlight?: string;
  plugins?: ("line-numbers" | "highlight-keywords")[];
};

export const Code: FC<CodeGroupProps> = ({ language, plugins, lineHighlight, code, className }) => {
  const loadDependencies = useCallback(async () => {
    if (language === "tsx") {
      // @ts-ignore
      await import(`prismjs/components/prism-jsx`);
      // @ts-ignore
      await import(`prismjs/components/prism-typescript`);
    }
    if (language === "html") {
      await import(`prismjs/components/prism-markup`);
    }
    if (language !== "html") {
      await import(`prismjs/components/prism-${language}`);
    }
    if (plugins?.includes("line-numbers")) {
      // @ts-ignore
      await import("prismjs/plugins/line-numbers/prism-line-numbers.js");
    }
    if (plugins?.includes("highlight-keywords")) {
      // @ts-ignore
      await import("prismjs/plugins/highlight-keywords/prism-highlight-keywords.js");
    }

    if (lineHighlight) {
      // @ts-ignore
      await import("prismjs/plugins/line-highlight/prism-line-highlight.js");
    }

    highlightAll();
  }, [language, lineHighlight, plugins]);

  useEffect(() => {
    loadDependencies();
  }, [language, loadDependencies]);

  return (
    <pre
      className={clsx(
        plugins,
        lineHighlight && "line-highlight",
        `language-${language}`,
        className
      )}
      data-line={lineHighlight}
      tabIndex={-1}
    >
      {(Array.isArray(code) ? code : [code]).map((code, index) => {
        return (
          <Fragment key={index}>
            <code className={`language-${language}`} data-selected-index={index}>
              {code}
            </code>
            {`\n`}
          </Fragment>
        );
      })}
    </pre>
  );
};
