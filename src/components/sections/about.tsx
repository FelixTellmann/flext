import { ABOUT } from "content/about";
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "~/components/image";
import { useTooltipStore } from "~/stores/tooltip-store";

type AboutProps = {};

export const About: FC<AboutProps> = (props) => {
  const imageRef = useRef<HTMLImageElement[]>([]);
  const [focusImageIndex, setFocusImageIndex] = useState(0);
  const [images, setImages] = useState(ABOUT.images);
  const [tooltip, setTooltip] = useTooltipStore();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The photos ship with !opacity-0 so a half-decoded image never flashes in; they are revealed once
  // loaded. next/image did this via onLoadingComplete, which has no equivalent on the plain <img>.
  const revealImage = useCallback((index: number) => {
    for (const image of document.querySelectorAll(`[data-about-image-index="${index}"]`)) {
      image.classList.remove("!opacity-0");
    }
  }, []);

  // Server-rendered images can finish loading before hydration attaches onLoad, so those never fire it.
  useEffect(() => {
    for (const image of document.querySelectorAll<HTMLImageElement>("[data-about-image-index]")) {
      if (image.complete) image.classList.remove("!opacity-0");
    }
  }, []);

  const handleImageClick = useCallback(() => {
    setTooltip(false);
    if (focusImageIndex === images.length - 1) {
      setFocusImageIndex((current) => current + 1);
      setImages((current) => current.sort(() => 0.5 - Math.random()));
      setTimeout(() => {
        setFocusImageIndex(0);
        setTooltip(true);
        const trigger = new Event("mouseover");
        setTimeout(() => {
          buttonRef.current?.dispatchEvent(trigger);
        }, 50);
      }, 350);
    }

    if (focusImageIndex < images.length - 1) {
      setFocusImageIndex((current) => current + 1);
      setTimeout(() => {
        setTooltip(true);
        const trigger = new Event("mouseover");
        setTimeout(() => {
          buttonRef.current?.dispatchEvent(trigger);
        }, 50);
      }, 50);
    }
  }, [focusImageIndex, images.length, setTooltip]);

  return (
    <section id="about" className="-mt-12 overflow-hidden pt-12">
      <div className="mx-auto flex max-w-6xl flex-col justify-center gap-16 px-4 pb-16 md:px-8 lg:grid lg:grid-cols-[540px_auto] lg:pt-16">
        <button
          ref={buttonRef}
          className="group relative mx-auto mb-12 aspect-3/2 max-h-[405px] w-full max-w-[540px] flex-1 hfa:outline-none lg:mr-0 lg:mb-auto lg:aspect-4/3"
          onClick={handleImageClick}
          type="button"
          data-event="mouseover"
          data-tip={images[focusImageIndex]?.alt}
        >
          <span className="sr-only">Cycle through Images</span>
          {images.map(({ src, alt }, index) => {
            return (
              <Image
                maxWidth={540}
                src={src}
                alt={alt}
                key={alt}
                width={2000}
                height={1500}
                preload
                className="!opacity-0 absolute top-0 left-0 rounded-xl border-2 border-gray-50/80 d:border-gray-600/80 object-cover shadow-gray-700/5 shadow-lg transition-all duration-300 group-focus-visible:border-sky-500"
                data-about-image-index={index}
                onLoad={() => revealImage(index)}
                style={{
                  transform:
                    focusImageIndex > index
                      ? `translate(-700px, -${(index % 4) * 60 + 25}px) rotate(${(index % 4) * (index % 2 === 0 ? 0.5 : -1.2) * 3}deg)`
                      : `rotate(${(index % 4) * (index % 2 === 0 ? 0.5 : -1.2) * 3}deg)`,
                  zIndex: -index,
                  filter: focusImageIndex !== index ? "grayscale(80)" : "",
                  opacity: focusImageIndex > index ? "0" : "1",
                }}
              />
            );
          })}
          <div className="relative -z-50 h-full w-full -rotate-6 rounded-xl bg-gray-200/80" />
        </button>
        <section className="spacing-8">
          <header className="grid max-w-xl grid-cols-2 gap-4 text-center sm:grid-cols-4 sm:text-left">
            {ABOUT.stats.map(({ statistic, caption, tooltip }, index) => {
              return (
                <figure key={caption + index} data-tip={tooltip} className="spacing-1 cursor-help select-none">
                  <span className="bg-gradient-to-r from-cyan-500 to-blue-600 bg-clip-text font-extrabold text-4xl text-transparent tracking-tighter">
                    {statistic}
                  </span>
                  <figcaption className="font-semibold d:text-gray-300/80 text-[15px] text-gray-400 tracking-tight">{caption}</figcaption>
                </figure>
              );
            })}
          </header>
          <main className="tracking tight max-w-3xl d:text-gray-100/70 text-gray-500 leading-relaxed [&>p+p]:mt-4">
            {ABOUT.description}
          </main>
        </section>
      </div>
    </section>
  );
};
