import { makeStore } from "_client/_stores/_make-store";

const { Provider, useStore } = makeStore<boolean>(false, "GloballyMounted");

export const useIsGloballyMounted = useStore;
export const GloballyMountedProvider = Provider;
