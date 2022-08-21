import { FC } from "react";

export const Font: FC = ({}) => {
  return (
    <link
      as="font"
      crossOrigin="anonymous"
      href="/fonts/inter-var-latin.woff2"
      rel="preload"
      type="font/woff2"
    />
  );
};
