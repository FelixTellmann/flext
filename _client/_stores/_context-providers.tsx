import { GloballyMountedProvider } from "_client/_stores/is-globally-mounted-store";
import { NotificationsProvider } from "_client/_stores/notifications-store";
import { PreloadedImagesProvider } from "_client/_stores/preloaded-images-store";
import { ThemeProvider } from "next-themes";
import { FC, PropsWithChildren } from "react";

export const ContextProviders: FC<PropsWithChildren<any>> = ({ children }) => {
  return (
    <PreloadedImagesProvider>
      <GloballyMountedProvider>
        <NotificationsProvider>
          <ThemeProvider attribute="class">{children}</ThemeProvider>
        </NotificationsProvider>
      </GloballyMountedProvider>
    </PreloadedImagesProvider>
  );
};
