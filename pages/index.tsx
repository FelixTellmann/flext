import { Typewriter } from "components/typewriter";
import { FC } from "react";

type IndexProps = {};

export const Index: FC<IndexProps> = (props) => {
  return (
    <>
      <section className="hero relative min-h-[80vh]">
        <div className="mx-auto max-w-6xl grid-cols-3 gap-8 px-4 py-32 md:grid md:px-8">
          <section className="col-span-2">
            <header>
              <div className="heading-pre">Welcome to my site.</div>
              <h1 className="heading-hero">
                I'm <strong>Felix Tellmann</strong>,{" "}
              </h1>
              <h2 className="heading-hero">
                <Typewriter
                  loop
                  items={[
                    <>
                      I'm a <u>Fullstack</u> developer
                    </>,
                    <>I build highly performant websites</>,
                    <>I'm a trained chef & dog owner 🐕</>,
                  ]}
                />
              </h2>
            </header>
          </section>
        </div>
        <div className="background pointer-events-none absolute inset-0 z-0 select-none "></div>
      </section>
    </>
  );
};

export default Index;
