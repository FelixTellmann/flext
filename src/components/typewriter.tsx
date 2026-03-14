import { useInView } from "framer-motion/dist/es/utils/use-in-view.mjs";
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { delay } from "utils/delay";
import { getRandomInteger } from "utils/get-random-integer";

type Sentence = { letter: string; parent: Node; element?: Node }[];

type TypewriterProps = {
  items: JSX.Element[] | string[];
  /* Natural speed is random 90 to 150 ms */
  speed?: [number, number] | number;
  /* Natural delete speed is random 30 to 70 ms */
  deleteSpeed?: number | [number, number];
  /* Hold after writing for default 2000 ms*/
  holdVisibleDuration?: number;
  loop?: boolean;
  waitUntilVisible?: boolean;
};

export const Typewriter: FC<TypewriterProps> = ({
  items,
  waitUntilVisible = true,
  speed = [90, 150],
  deleteSpeed = [30, 70],
  holdVisibleDuration = 2000,
  loop = true,
}) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(containerRef, { once: true });
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [visible, setVisible] = useState("");
  const contentRef = useRef<(HTMLSpanElement | null)[]>([]);
  const [writing, setWriting] = useState(false);

  const write = useCallback(
    async (currentIndex: number) => {
      if (writing) return;
      setWriting(true);
      contentRef.current?.forEach((el) => el?.classList?.add("hidden"));
      contentRef.current[currentIndex]?.classList?.remove("hidden");
      const sentence = sentences[currentIndex] ?? [];
      for (let i = 0; i < sentence.length; i++) {
        await delay(Array.isArray(speed) ? getRandomInteger(speed) : speed);
        let nextNode: any = null;
        const currentParent = sentence[i].parent;
        for (let j = i; j < sentence.length; j++) {
          if (currentParent !== sentence[j].parent) {
            nextNode = sentence[j].parent;
            break;
          }
        }
        const letter = document.createElement("span");
        letter.innerHTML = sentence[i].letter;
        if (nextNode && currentParent.contains(nextNode)) {
          sentence[i].parent.insertBefore(letter, nextNode);
          sentence[i].element = letter;
        }
        if (!nextNode || !currentParent.contains(nextNode)) {
          sentence[i].parent.appendChild(letter);
          sentence[i].element = letter;
        }
      }

      await delay(holdVisibleDuration);

      if (!loop && currentIndex + 1 === contentRef.current.length) {
        return;
      }
      for (let i = sentence.length; i >= 0; i--) {
        await delay(Array.isArray(deleteSpeed) ? getRandomInteger(deleteSpeed) : deleteSpeed);

        // @ts-ignore
        sentence[i]?.element?.parentNode?.removeChild(sentence[i].element);
      }

      setWriting(false);
      setCurrentSentenceIndex((current) =>
        current + 1 === contentRef.current.length ? 0 : current + 1
      );
    },
    [deleteSpeed, holdVisibleDuration, loop, sentences, speed, writing]
  );

  useEffect(() => {
    const results: Sentence[] = [];
    contentRef.current.forEach((element: HTMLElement, index) => {
      results[index] = results[index] ?? [];
      const parseNodes = (parentNode: Node) => {
        parentNode?.childNodes.forEach((node) => {
          if (node?.nodeName === "#text") {
            node?.textContent?.split("").forEach((letter) => {
              results[index].push({ letter, parent: parentNode });
            });
            node.textContent = "";
          }
          if (node?.childNodes?.length) {
            parseNodes(node);
          }
        });
      };
      parseNodes(element);
    });
    setSentences((current) => current ?? results);
  }, [items]);

  useEffect(() => {
    if (!sentences) return;
    if ((waitUntilVisible && inView) || !waitUntilVisible) {
      write(currentSentenceIndex);
    }
  }, [currentSentenceIndex, inView, sentences, waitUntilVisible, write]);

  return (
    <span ref={containerRef}>
      {items.map((item, index) => {
        return (
          <span
            ref={(ref) => (contentRef.current[index] = ref)}
            key={index}
            aria-hidden
            className="hidden after:animate-blink after:content-['|']"
          >
            {item}
          </span>
        );
      })}
      <ul className="sr-only">
        {items.map((item, index) => {
          return <li key={index}>{item}</li>;
        })}
      </ul>
    </span>
  );
};
