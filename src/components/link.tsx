import { Link as RouterLink } from "@tanstack/react-router";
import { type AnchorHTMLAttributes, type FC, type PropsWithChildren, useCallback } from "react";
import { isExternalUrl } from "utils/is-external-url";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  prefetch?: boolean;
  shallow?: boolean;
  scroll?: boolean;
  replace?: boolean;
  passHref?: boolean;
  locale?: string;
  legacyBehavior?: boolean;
};

export const Link: FC<PropsWithChildren<LinkProps>> = ({
  children,
  href,
  onClick,
  prefetch,
  shallow,
  scroll,
  replace,
  passHref,
  locale,
  legacyBehavior,
  ...anchorProps
}) => {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (window.self !== window.top && href) {
        e.preventDefault();
        e.stopPropagation();
        window?.parent?.postMessage({ source: "theme-content", topic: "redirect", href }, "*");
      }
      onClick?.(e);
    },
    [href, onClick],
  );

  if (!href) {
    return (
      <span onClick={onClick} {...anchorProps}>
        {children}
      </span>
    );
  }

  const cleanHref = typeof href === "string" ? href.replace(/^\/products\//gi, "/") : href;

  if (isExternalUrl(href)) {
    return (
      <a href={cleanHref} rel={anchorProps?.target === "_blank" ? "noopener noreferrer" : undefined} onClick={onClick} {...anchorProps}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink to={cleanHref} onClick={handleClick} {...(anchorProps as any)}>
      {children}
    </RouterLink>
  );
};
