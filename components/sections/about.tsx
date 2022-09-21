import { useTooltipStore } from "components/_stores/tooltip-store";
import { Image } from "components/image";
import { ABOUT } from "content/about";
import { FC, useCallback, useRef, useState } from "react";

type AboutProps = {};

export const About: FC<AboutProps> = (props) => {
  const imageRef = useRef<HTMLImageElement[]>([]);
  const [focusImageIndex, setFocusImageIndex] = useState(0);
  const [images, setImages] = useState(ABOUT.images);
  const [tooltip, setTooltip] = useTooltipStore();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleImageClick = useCallback(() => {
    setTooltip(false);
    if (focusImageIndex === images.length - 1) {
      setFocusImageIndex((current) => current + 1);
      setImages((current) => current.sort(() => 0.5 - Math.random()));
      setTimeout(
        () => {
          setFocusImageIndex(0);
          setTooltip(true);
          const trigger = new Event("mouseover");
          setTimeout(
            () => {
              buttonRef.current?.dispatchEvent(trigger);
            },
            50
          );
        },
        350
      );
    }

    if (focusImageIndex < images.length - 1) {
      setFocusImageIndex((current) => current + 1);
      setTimeout(
        () => {
          setTooltip(true);
          const trigger = new Event("mouseover");
          setTimeout(
            () => {
              buttonRef.current?.dispatchEvent(trigger);
            },
            50
          );
        },
        50
      );
    }
  }, [focusImageIndex, images.length, setTooltip]);

  return (
    <section id="about" className="-mt-12 overflow-hidden pt-12">
      <div className="mx-auto flex max-w-6xl flex-col justify-center gap-16 px-4 pb-16 md:px-8 lg:grid lg:grid-cols-[540px_auto] lg:pt-16">
        <button
          ref={buttonRef}
          className="group relative mx-auto mb-12 aspect-3/2 max-h-[405px] w-full max-w-[540px] flex-1 hfa:outline-none lg:mb-auto  lg:mr-0 lg:aspect-4/3"
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
                sizes="(min-width: 580px) 540px, 400px"
                preload
                priority={index === 0}
                className="absolute left-0 top-0 rounded-xl border-2 border-gray-50/80 object-cover !opacity-0 shadow-lg shadow-gray-700/5 transition-all duration-300 group-focus-visible:border-sky-500 d:border-gray-600/80"
                data-about-image-index={index}
                onLoadingComplete={() =>
                  document
                    .querySelectorAll(`[data-about-image-index="${index}"]`)
                    .forEach((img) => img.classList.remove("!opacity-0"))
                }
                style={{
                  transform:
                    focusImageIndex > index
                      ? `translate(-700px, -${(index % 4) * 60 + 25}px) rotate(${
                          (index % 4) * (index % 2 === 0 ? 0.5 : -1.2) * 3
                        }deg)`
                      : `rotate(${(index % 4) * (index % 2 === 0 ? 0.5 : -1.2) * 3}deg)`,
                  zIndex: -index,
                  filter: focusImageIndex !== index ? "grayscale(80)" : "",
                  opacity: focusImageIndex > index ? "0" : "1",
                }}
              />
            );
          })}
          <div className="relative -z-50 h-full w-full -rotate-6 rounded-xl bg-gray-200/80"></div>
        </button>
        <section className="spacing-8">
          <header className="grid max-w-xl grid-cols-2 gap-4 text-center sm:grid-cols-4 sm:text-left">
            {ABOUT.stats.map(({ statistic, caption, tooltip }, index) => {
              return (
                <figure
                  key={caption + index}
                  data-tip={tooltip}
                  className="cursor-help select-none spacing-1"
                >
                  <span className="bg-gradient-to-r from-cyan-500 to-blue-600 bg-clip-text text-4xl font-extrabold tracking-tighter text-transparent">
                    {statistic}
                  </span>
                  <figcaption className="text-[15px] font-semibold tracking-tight text-gray-400 d:text-gray-300/80">
                    {caption}
                  </figcaption>
                </figure>
              );
            })}
          </header>
          <main className="tracking tight max-w-3xl leading-relaxed text-gray-500 d:text-gray-100/70 [&>p+p]:mt-4">
            {ABOUT.description}
          </main>
        </section>
      </div>
    </section>
  );
};
