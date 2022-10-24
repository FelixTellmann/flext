type EaseInOutQuadOptions = {
  change: number;
  currentTime: number;
  duration: number;
  start: number;
};

const easeInOutQuad = ({ currentTime, start, change, duration }: EaseInOutQuadOptions) => {
  let newCurrentTime = currentTime;
  newCurrentTime /= duration / 2;

  if (newCurrentTime < 1) {
    return (change / 2) * newCurrentTime * newCurrentTime + start;
  }

  newCurrentTime -= 1;
  return (-change / 2) * (newCurrentTime * (newCurrentTime - 2) - 1) + start;
};

export const scrollToY = (
  duration: number,
  to: number,
  container: HTMLElement | Window = window,
  callback: () => void = () => {}
): void => {
  const start = container instanceof HTMLElement ? container.scrollTop : container.scrollY;

  const change = to - start;
  const startDate = new Date().getTime();

  const animateScroll = () => {
    const currentDate = new Date().getTime();
    const currentTime = currentDate - startDate;

    container.scrollTo(
      0,
      easeInOutQuad({
        currentTime,
        start,
        change,
        duration,
      })
    );

    if (currentTime < duration) {
      requestAnimationFrame(animateScroll);
    } else {
      container.scrollTo(0, to);
      callback();
    }
  };
  animateScroll();
};

export const scrollToX = (
  duration: number,
  to: number,
  container: HTMLElement | Window = window,
  callback: () => void = () => {}
): void => {
  const start = container instanceof HTMLElement ? container.scrollLeft : container.scrollX;

  const change = to - start;
  const startDate = new Date().getTime();

  const animateScroll = () => {
    const currentDate = new Date().getTime();
    const currentTime = currentDate - startDate;

    container.scrollTo(
      easeInOutQuad({
        currentTime,
        start,
        change,
        duration,
      }),
      0
    );

    if (currentTime < duration) {
      requestAnimationFrame(animateScroll);
    } else {
      container.scrollTo(to, 0);
      callback();
    }
  };
  animateScroll();
};
