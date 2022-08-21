export const isImage = (url = ""): boolean => {
  return /\.(jpg|jpeg|png|webp|avif|gif|svg)$/.test(url);
};
