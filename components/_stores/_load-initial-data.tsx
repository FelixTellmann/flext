import { useIsGloballyMounted } from "components/_stores/is-globally-mounted-store";
import { useNotifications } from "components/_stores/notifications-store";
import { useTooltipStore } from "components/_stores/tooltip-store";

import { Toast } from "components/toast";
import dynamic from "next/dynamic";
import { FC, PropsWithChildren, useEffect, useState } from "react";
import ReactTooltipType from "react-tooltip";
//

const ReactTooltip = dynamic(() => import("react-tooltip").then((mod) => mod), {
  ssr: false,
}) as typeof ReactTooltipType;

export const LoadInitialData: FC<PropsWithChildren<any>> = ({ children }) => {
  const [tooltip] = useTooltipStore();
  const [showTooltip, setShowTooltip] = useState(true);
  const [isGloballyMounted, setIsGloballyMounted] = useIsGloballyMounted();
  const [notifications, setNotifications] = useNotifications();
  // useInitShopifyData();

  useEffect(() => {
    const hideTooltip = () => {
      setTimeout(
        () => {
          setShowTooltip(false);
          setTimeout(
            () => {
              setShowTooltip(true);
            },
            10
          );
        },
        200
      );
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
      {isGloballyMounted && tooltip
        ? <ReactTooltip
            place="bottom"
            effect="solid"
            wrapper="span"
            arrowColor="white"
            delayHide={500}
            clickable={true}
            // possibleCustomEventsOff="hide-global-tooltip"
            className="relative !border-none !border-transparent !p-0"
            getContent={(content) => {
              return (
                <span className="pointer-events-auto block h-[calc(100%+1px)] w-[calc(100%+1px)] max-w-[calc(100vw-32px)] select-none rounded-sm border-card bg-white py-2 px-5 text-slate-700 opacity-100 shadow-xl">
                  {content}
                </span>
              );
            }}
          />
        : null}
    </>
  );
};
