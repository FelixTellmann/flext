import { Link } from "components/link";
import clsx from "clsx";
import { HEADER } from "content/layout";
import { Property } from "csstype";
import { FC, MouseEventHandler, useCallback } from "react";
import BorderWidth = Property.BorderWidth;
import Width = Property.Width;

type HeaderMobileNavProps = {
  setShowNav: (value: ((prevState: boolean) => boolean) | boolean) => void;
  showNav: boolean;
};

const MobileNavButton = ({
  active,
  border,
  size,
  onClick,
}: {
  border: BorderWidth;
  size: Width;
  active: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative z-50 p-1"
      style={{ "--nav-icon-size": size, "--nav-icon-border": border }}
    >
      <span className="sr-only">Mobile Navigation</span>
      <i className={clsx("burger-menu", active && "active")}>
        <div></div>
      </i>
    </button>
  );
};

export const MobileNav: FC<HeaderMobileNavProps> = ({ showNav, setShowNav }) => {
  const toggleNav = useCallback(() => {
    setShowNav((current) => !current);
  }, [setShowNav]);

  return (
    <div className="md:hidden">
      <MobileNavButton size="24px" border="2px" onClick={toggleNav} active={showNav} />
      <div
        className={clsx(
          " fixed top-0 left-0 h-screen w-full",
          showNav
            ? "nav-active opacity-100"
            : "pointer-events-none select-none opacity-0 delay-[900ms]"
        )}
      >
        <div className="absolute inset-0 -z-50 grid grid-cols-[1rem_repeat(16,minmax(0,1fr))_1rem]">
          {[...new Array(18)].map((_, index) => {
            return (
              <div
                className={clsx(
                  "pointer-events-none relative h-full -translate-y-full select-none bg-slate-900 transition-all duration-300 ease-linear",
                  index === 0 &&
                    "relative before:absolute b:top-0 b:right-0 b:h-full b:w-px b:bg-[linear-gradient(180deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] b:bg-[length:1px_8px] b:opacity-20",
                  index === 17 &&
                    "relative before:absolute b:top-0 b:left-0 b:h-full b:w-px b:bg-[linear-gradient(180deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] b:bg-[length:1px_8px] b:opacity-20"
                )}
                style={{
                  transitionDelay: showNav ? `${index * 0.01}s` : `${index * 0.025}s`,
                  "--tw-translate-y": showNav ? "0%" : "-100%",
                }}
                key={index}
              />
            );
          })}
        </div>
        <section className="mt-28 p-8 spacing-24">
          <nav className="relative text-white spacing-6">
            {HEADER.nav.map((navItem, index) => {
              return (
                <Link
                  key={navItem.href}
                  href={navItem.href}
                  className="group flex items-baseline justify-between py-2 text-gray-300 opacity-0 opacity-0 transition-opacity delay-200 hfa:text-sky-400 [.nav-active_&]:opacity-100"
                  onClick={() => setShowNav(false)}
                >
                  <span
                    className="-translate-x-[200%] text-[17px] font-medium [.nav-active_&]:translate-x-0"
                    style={{
                      transition: showNav
                        ? `transform 0.15s ${0.4 + 0.05 * index}s`
                        : `transform 0.15s ${0.05 * index}s`,
                    }}
                  >
                    {navItem.title}
                  </span>
                  <div className="mx-2 h-px flex-1 bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] opacity-0 transition-opacity [.nav-active_&]:opacity-40 [.nav-active_&]:delay-500"></div>
                  <small
                    className="translate-x-[200%] text-gray-400 [.nav-active_&]:translate-x-0"
                    style={{
                      transition: showNav
                        ? `transform 0.15s ${0.4 + 0.05 * index}s`
                        : `transform 0.15s ${0.05 * index}s`,
                    }}
                  >
                    {navItem.alt}
                  </small>
                </Link>
              );
            })}
          </nav>
          <div
            className="flex translate-y-8 items-center justify-center opacity-0 [.nav-active_&]:translate-y-0 [.nav-active_&]:opacity-100 [.nav-active_&]:delay-500"
            style={{
              transition: showNav
                ? `transform 0.15s 0.35s, opacity 0.2s 0.35s`
                : `transform 0.15s ${0.05}s, opacity 0.2s 0.05s`,
            }}
          >
            <button className="button-rainbow  whitespace-nowrap border-[4px] border-opacity-40 px-10 py-3 font-medium tracking-tight text-gray-900 ">
              Lets work
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
