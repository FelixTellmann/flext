import clsx from "clsx";
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { getParentNodeByTag } from "utils/get-parent-node-by-class";

export const HoverEffect: FC<{ className?: string }> = ({ className = "" }) => {
  const [initialNavPosition, setInitialNavPosition] = useState({
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    opacity: 0,
    transition: "0.1s opacity",
    borderRadius: 0,
  });
  const navHoverEffect = useRef<HTMLDivElement>(null);

  // const [navHover, setNavHover] = useState(initialNavPosition);

  const setNavHover = useCallback(
    ({ width, top, left, opacity, transition, height, borderRadius }) => {
      const element = navHoverEffect.current as HTMLDivElement;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.transition = transition;
      element.style.opacity = opacity;
      element.style.borderRadius = borderRadius;
    },
    []
  );

  const handleNavHover = useCallback((e) => {
    const element = navHoverEffect.current as HTMLDivElement;
    if (e.target === e.currentTarget) {
      setNavHover(initialNavPosition);
    }
    if (e.target !== e.currentTarget) {
      const navItemRef = getParentNodeByTag(e.target as HTMLElement, "A");

      if (navItemRef) {
        setNavHover({
          width: navItemRef.offsetWidth,
          height: navItemRef.offsetHeight,
          left: navItemRef.offsetLeft,
          top: navItemRef.offsetTop,
          opacity: 1,
          borderRadius: getComputedStyle(navItemRef).borderRadius,
          transition: +element.style.opacity
            ? "0.18s all, 0.1s opacity"
            : "0s all, 0.1s 0.0.2s opacity",
        });
      }
    }
  }, [initialNavPosition, setNavHover]);

  const handleNavFocus = useCallback((e) => {
    const element = navHoverEffect.current as HTMLDivElement;
    if (!e?.currentTarget?.matches(":focus-within")) {
      setNavHover(initialNavPosition);
      return;
    }

    const navItemRef = getParentNodeByTag(e.target as HTMLElement, "A");
    if (navItemRef) {
      setNavHover({
        width: navItemRef.offsetWidth,
        height: navItemRef.offsetHeight,
        left: navItemRef.offsetLeft,
        top: navItemRef.offsetTop,
        borderRadius: getComputedStyle(navItemRef).borderRadius,
        opacity: 1,
        transition: +element.style.opacity
          ? "0.18s all, 0.1s opacity"
          : "0s all, 0.1s 0.0.2s opacity",
      });
    }
  }, [initialNavPosition, setNavHover]);

  const handleNavReset = useCallback(() => {
    setNavHover(initialNavPosition);
  }, [initialNavPosition, setNavHover]);

  useEffect(() => {
    const element = navHoverEffect.current as HTMLDivElement;
    const parent = element.parentElement as HTMLElement;
    const links = parent.querySelectorAll("a");
    parent.addEventListener("blur", handleNavFocus);
    parent.addEventListener("mouseover", handleNavHover);
    parent.addEventListener("mouseleave", handleNavReset);
    links.forEach((link) => {
      link.addEventListener("focus", handleNavFocus);
    });

    return () => {
      parent.removeEventListener("blur", handleNavFocus);
      parent.removeEventListener("mouseover", handleNavHover);
      parent.removeEventListener("mouseleave", handleNavReset);
      links.forEach((link) => {
        link.removeEventListener("focus", handleNavFocus);
      });
    };
  }, [handleNavFocus, handleNavHover, handleNavReset]);

  return (
    <div
      ref={navHoverEffect}
      className={clsx(
        "button-border /*-translate-y-1/2*/ pointer-events-none absolute -z-10 select-none d:border-gray-300/50",
        className
      )}
      style={{ opacity: "0" }}
    />
  );
};
