import { useIsGloballyMounted } from "_client/_stores/is-globally-mounted-store";
import { FC, PropsWithChildren, useEffect } from "react";

export const LoadInitialData: FC<PropsWithChildren<any>> = ({ children }) => {
  const [_, setIsGloballyMounted] = useIsGloballyMounted();

  // useInitShopifyData();

  useEffect(() => {
    setIsGloballyMounted(true);
  }, [setIsGloballyMounted]);

  return <>{children}</>;
};
