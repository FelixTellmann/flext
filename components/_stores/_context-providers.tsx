import { GloballyMountedProvider } from "components/_stores/is-globally-mounted-store";
import { NotificationsProvider } from "components/_stores/notifications-store";
import { PreloadedImagesProvider } from "components/_stores/preloaded-images-store";
import { TooltipProvider } from "components/_stores/tooltip-store";
import { ThemeProvider } from "next-themes";
import { FC, PropsWithChildren } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

export const ContextProviders: FC<PropsWithChildren<any>> = ({ children }) => {
  return (
    <PreloadedImagesProvider>
      <GloballyMountedProvider>
        <NotificationsProvider>
          <ThemeProvider attribute="class">
            <LazyMotion features={domAnimation}>
              <TooltipProvider>{children}</TooltipProvider>
            </LazyMotion>
          </ThemeProvider>
        </NotificationsProvider>
      </GloballyMountedProvider>
    </PreloadedImagesProvider>
  );
};
