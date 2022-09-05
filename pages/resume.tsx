import { FC, useEffect, useRef } from "react";

type ResumeProps = {};

export const Resume: FC<ResumeProps> = (props) => {
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    console.log(asideRef.current!.getBoundingClientRect());
  }, []);

  return (
    <>
      <article className="relative mx-auto grid max-w-6xl grid-cols-[1fr_280px] gap-8 px-4 py-16 md:px-8">
        <main className="min-h-[200vh] spacing-8">
          <section>
            <h2 className="text-xl font-bold tracking-tight text-gray-800">Intro</h2>
            <p className="leading-relaxed text-gray-600">
              Welcome I'm Felix Tellmann, I am looking for work to do this and that Lorem ipsum
              dolor sit amet, consectetur adipisicing elit. Accusamus architecto cum, enim error
              est, et fuga hic iusto maiores modi numquam, quas rem sit unde veritatis? Dolore illo
              iure natus? A blanditiis cumque ducimus facilis incidunt iure nemo officiis
              voluptatibus?
            </p>
          </section>
          <section>
            <h2 className="mb-4 text-xl font-bold tracking-tight text-gray-800">Experience</h2>
            <main className="spacing-6">
              {[...new Array(2)].map((_, index) => {
                return (
                  <section className="relative flex" key={index}>
                    <aside className="absolute left-4 top-1.5 h-full">
                      <div className="absolute left-0 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-gray-200">
                        <h3 className="absolute top-0 right-full mr-6 text-right text-[13px] font-medium leading-[16px] text-gray-500">
                          2022
                        </h3>
                        <div className="h-2 w-2 rounded-full bg-gray-400"></div>
                      </div>
                      <i className="absolute left-0 top-4 h-[calc(100%+24px-1.375rem)] w-0.5 -translate-x-1/2 bg-gray-200" />
                    </aside>

                    <main className="ml-12">
                      <p className="bg-gradient-to-b from-red-500 to-green-400 bg-clip-text leading-relaxed text-gray-600">
                        Lorem ipsum dolor sit amet, consectetur adipisicing elit. Aperiam,
                        consequatur dicta dolorum eligendi fugiat iste laudantium odio odit pariatur
                        placeat provident quam quos rerum! Aperiam hic id ipsum libero non optio,
                        provident quo repellendus sed similique temporibus ullam veniam, voluptas!
                        Explicabo laborum qui reiciendis voluptatibus.
                      </p>
                    </main>
                  </section>
                );
              })}
            </main>
          </section>
          <section></section>
        </main>
        <aside className="sticky top-[144px] mb-auto max-h-min spacing-8" ref={asideRef}>
          <section className="h-64 rounded-md border-2 border-gray-200 p-2"></section>
          <section className="h-64 rounded-md border-2 border-gray-200 p-2"></section>
        </aside>
      </article>
    </>
  );
};

export default Resume;
