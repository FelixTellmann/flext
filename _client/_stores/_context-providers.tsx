import { GloballyMountedProvider } from "_client/_stores/is-globally-mounted-store";
import { NotificationsProvider } from "_client/_stores/notifications-store";
import { PreloadedImagesProvider } from "_client/_stores/preloaded-images-store";
import { ThemeProvider } from "next-themes";
import { FC, PropsWithChildren } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

export const ContextProviders: FC<PropsWithChildren<any>> = ({ children }) => {
  return (
    <PreloadedImagesProvider>
      <GloballyMountedProvider>
        <NotificationsProvider>
          <ThemeProvider attribute="class">
            <LazyMotion features={domAnimation}>{children}</LazyMotion>
          </ThemeProvider>
        </NotificationsProvider>
      </GloballyMountedProvider>
    </PreloadedImagesProvider>
  );
};
