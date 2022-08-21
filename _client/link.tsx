import NextLink, { LinkProps as NextLinkProps } from "next/link";
import { AnchorHTMLAttributes, FC, useCallback } from "react";
import { isExternalUrl } from "utils/is-external-url";

export type LinkProps = AnchorHTMLAttributes<any> & NextLinkProps;

export const Link: FC<LinkProps> = ({
  children,
  href,
  as,
  replace,
  scroll,
  shallow,
  passHref,
  prefetch,
  locale,
  legacyBehavior,
  onClick,
  ...AnchorProps
}) => {
  const nextLinkProps = {
    href,
    as,
    replace,
    scroll,
    shallow,
    passHref,
    prefetch,
    locale,
    legacyBehavior,
  };

  const handleClick = useCallback((e) => {
    if (window.self !== window.top && href) {
      e.preventDefault();
      e.stopPropagation();

      window?.parent?.postMessage(
        {
          source: "theme-content",
          topic: "redirect",
          href: href,
        },
        "*"
      );
    }
    if (onClick) {
      onClick(e);
    }
  }, [href, onClick]);

  return (
    <>
      {href && !isExternalUrl(href)
        ? <NextLink
            {...nextLinkProps}
            href={typeof href === "string" ? href.replace(/^\/products\//gi, "/") : href}
          >
            <a onClick={handleClick} {...AnchorProps}>
              {children}
            </a>
          </NextLink>
        : href
        ? <a
            href={typeof href === "string" ? href.replace(/^\/products\//gi, "/") : href}
            rel={AnchorProps?.target === "_blank" ? "noopener noreferrer" : undefined}
            onClick={onClick}
            {...AnchorProps}
          >
            {children}
          </a>
        : <span onClick={onClick} {...AnchorProps}>
            {children}
          </span>}
    </>
  );
};
