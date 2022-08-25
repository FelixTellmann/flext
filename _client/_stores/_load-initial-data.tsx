import { useIsGloballyMounted } from "_client/_stores/is-globally-mounted-store";
import { useNotifications } from "_client/_stores/notifications-store";
import { FC, PropsWithChildren, useEffect } from "react";

export const LoadInitialData: FC<PropsWithChildren<any>> = ({ children }) => {
  const [_, setIsGloballyMounted] = useIsGloballyMounted();
  const [notifications, setNotifications] = useNotifications();
  // useInitShopifyData();

  useEffect(() => {
    setIsGloballyMounted(true);
  }, [setIsGloballyMounted]);

  return <>{children}</>;
};
