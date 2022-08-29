import { Switch } from "@headlessui/react";
import clsx from "clsx";
import { FC, useRef } from "react";

type ToggleSwitchProps = {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  enabledIcon?: JSX.Element;
  disabledIcon?: JSX.Element;
};

export const ToggleSwitch: FC<ToggleSwitchProps> = ({
  enabled,
  setEnabled,
  enabledIcon,
  disabledIcon,
}) => {
  const switchRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Switch
        ref={switchRef}
        checked={enabled}
        onChange={setEnabled}
        className={clsx(
          enabled ? " from-pink-400 to-violet-500" : "from-yellow-200 to-orange-300",
          "relative h-9 w-16 flex-shrink-0 cursor-pointer rounded-full border-2 border-gray-500/40 bg-gradient-to-r bg-clip-padding p-0.5 transition-colors duration-200 ease-in-out focus:outline-none"
        )}
      >
        <span className="sr-only">Switch Color Theme</span>
        <div
          className={clsx(
            enabled ? "translate-x-[calc(100%)]" : "translate-x-0",
            "pointer-events-none relative aspect-1 h-full transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
          )}
          style={{
            transform: enabled
              ? `translateX(calc(${switchRef.current?.clientWidth}px - 100% - 4px))`
              : "translateX(0px)",
          }}
        >
          <figure
            className={clsx(
              enabled ? "opacity-0 duration-100 ease-out" : "opacity-100 duration-200 ease-in",
              "absolute inset-0 flex h-full w-full items-center justify-center transition-opacity"
            )}
            aria-hidden="true"
          >
            {disabledIcon}
          </figure>
          <figure
            className={clsx(
              enabled ? "opacity-100 duration-200 ease-in" : "opacity-0 duration-100 ease-out",
              "absolute inset-0 flex h-full w-full items-center justify-center transition-opacity"
            )}
            aria-hidden="true"
          >
            {enabledIcon}
          </figure>
        </div>
      </Switch>
    </>
  );
};

export default ToggleSwitch;
