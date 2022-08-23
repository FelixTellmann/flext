export const getParentNodeByClass = (
  target: HTMLElement,
  className: string,
  i = 0
): HTMLElement | null => {
  if (i > 40) {
    return null;
  }
  if (target?.classList?.contains(className)) {
    return target;
  }
  if (target.parentNode) {
    return getParentNodeByClass(target.parentNode as HTMLElement, className, i++);
  }
  return null;
};

export const getParentNodeByTag = (
  target: HTMLElement,
  tagName: string,
  i = 0
): HTMLElement | null => {
  if (i > 40) {
    return null;
  }
  if (target?.tagName === tagName.toUpperCase()) {
    return target;
  }
  if (target.parentNode) {
    return getParentNodeByTag(target.parentNode as HTMLElement, tagName, i++);
  }
  return null;
};
