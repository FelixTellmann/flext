import { GloballyMountedProvider } from "~/stores/is-globally-mounted-store";
import { NotificationsProvider } from "~/stores/notifications-store";
import { PreloadedImagesProvider } from "~/stores/preloaded-images-store";
import { TooltipProvider } from "~/stores/tooltip-store";
import { ThemeProvider } from "~/components/theme-provider";
import type { FC, PropsWithChildren } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

export const ContextProviders: FC<PropsWithChildren> = ({ children }) => {
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
