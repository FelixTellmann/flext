import { useIsGloballyMounted } from "_client/_stores/is-globally-mounted-store";
import { useNotifications } from "_client/_stores/notifications-store";
import { useTooltipStore } from "_client/_stores/tooltip-store";

import { Toast } from "components/toast";
import { FC, PropsWithChildren, useEffect, useState } from "react";
import ReactTooltip from "react-tooltip";

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
    ReactTooltip.rebuild();
  }, []);

  useEffect(() => {
    setIsGloballyMounted(true);
  }, [setIsGloballyMounted]);

  return (
    <>
      {children}
      <Toast />
      {isGloballyMounted
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
                <div className="pointer-events-auto h-[calc(100%+1px)] w-[calc(100%+1px)] select-none rounded-sm border-card bg-white py-2 px-5 text-slate-700 opacity-100 shadow-xl dark:text-gray-50">
                  {content}
                </div>
              );
            }}
          />
        : null}
    </>
  );
};
