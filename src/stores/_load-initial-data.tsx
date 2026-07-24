import type { FC, PropsWithChildren } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toast } from "~/components/toast";
import { useIsGloballyMounted } from "~/stores/is-globally-mounted-store";
import { useNotifications } from "~/stores/notifications-store";
import { useTooltipStore } from "~/stores/tooltip-store";

//

const ReactTooltip = lazy(() => import("react-tooltip"));

export const LoadInitialData: FC<PropsWithChildren> = ({ children }) => {
  const [tooltip] = useTooltipStore();
  const [showTooltip, setShowTooltip] = useState(true);
  const [isGloballyMounted, setIsGloballyMounted] = useIsGloballyMounted();
  const [notifications, setNotifications] = useNotifications();
  // useInitShopifyData();

  useEffect(() => {
    const hideTooltip = () => {
      setTimeout(() => {
        setShowTooltip(false);
        setTimeout(() => {
          setShowTooltip(true);
        }, 10);
      }, 200);
    };
    window.addEventListener("scroll", hideTooltip);
    return () => {
      window.removeEventListener("scroll", hideTooltip);
    };
  }, []);

  useEffect(() => {
    setIsGloballyMounted(true);
  }, [setIsGloballyMounted]);

  return (
    <>
      {children}
      <Toast />
      {isGloballyMounted && tooltip ? (
        <Suspense fallback={null}>
          <ReactTooltip
            place="bottom"
            effect="solid"
            wrapper="span"
            arrowColor="white"
            delayHide={500}
            clickable={true}
            // possibleCustomEventsOff="hide-global-tooltip"
            className="!border-none !border-transparent !p-0 relative"
            getContent={(content) => {
              return (
                <span className="pointer-events-auto block h-[calc(100%+1px)] w-[calc(100%+1px)] max-w-[calc(100vw-32px)] select-none rounded-sm border-card bg-white px-5 py-2 text-slate-700 opacity-100 shadow-xl">
                  {content}
                </span>
              );
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
};
