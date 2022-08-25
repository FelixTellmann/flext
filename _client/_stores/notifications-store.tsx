import { makeStore } from "_client/_stores/_make-store";

const { Provider, useStore } = makeStore<
  {
    id: string;
    message: string;
    onDismiss?: (e: MouseEvent) => void;
    error?: boolean;
  }[]
>([], "Notifications Store");

export const useNotifications = useStore;
export const NotificationsProvider = Provider;
