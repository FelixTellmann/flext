export const isExternalUrl = (url: string): boolean => {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const host = window?.location?.hostname ?? process.env.NEXT_PUBLIC_HOSTNAME;

    const linkHost = ((url) => {
      if (/^https?:\/\//.test(url)) {
        const anchorElement = document.createElement("a");
        anchorElement.href = url;
        return anchorElement.hostname;
      }
      return window?.location?.hostname ?? process.env.NEXT_PUBLIC_HOSTNAME;
    })(url);

    return host !== linkHost;
  }

  const host = process.env.NEXT_PUBLIC_HOSTNAME;

  const linkHost = ((url) => {
    if (/^(https?:)?\/\//.test(url)) {
      return url.replace(/^(https?:)?\/\//gi, "").split(/(\/|\\|\?)/gi)[0];
    }
    return process.env.NEXT_PUBLIC_HOSTNAME;
  })(url);

  return host !== linkHost;
};
