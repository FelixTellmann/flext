import { makeStore } from "components/_stores/_make-store";

const { Provider, useStore } = makeStore<string[]>([], "PreloadedImages");

export const usePreloadedImages = useStore;
export const PreloadedImagesProvider = Provider;
