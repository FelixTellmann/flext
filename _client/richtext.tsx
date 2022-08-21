import parse from "html-react-parser";
import { FC, PropsWithChildren } from "react";

type ParagraphProps = {
  className?: string;
};

export const Richtext: FC<PropsWithChildren<ParagraphProps>> = ({ children, className = "" }) => {
  return (
    <div className={className}>
      {typeof children === "string" ? parse(children as string) : null}
    </div>
  );
};
