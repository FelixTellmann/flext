import { Image } from "_client/image";
import { BOOKS } from "content/books";
import { FC } from "react";
import { Link } from "_client/link";

type BooksProps = {};

export const Books: FC<BooksProps> = (props) => {
  return (
    <>
      <section className="relative mx-auto flex max-w-6xl px-4 py-16 md:px-8">
        <div className="grid w-full gap-8 md:grid-cols-2 xl:grid-cols-3">
          {BOOKS.map((book) => (
            <article
              key={book.name}
              className="items-center rounded-lg bg-gray-100/50 p-4 spacing-4"
            >
              <Link href={book.url} className="items-center spacing-4" target="_blank">
                <figure className="aspect-[0.666] w-[140px] max-w-[140px] overflow-hidden">
                  <Image
                    src={book.image}
                    maxWidth={240}
                    width={240}
                    height={366}
                    alt={book.name}
                    className="-m-0.5 h-[calc(100%+0.25rem)] w-[calc(100%+0.25rem)] max-w-none object-cover object-center"
                  />
                </figure>
                <h2 className="text-center font-semibold tracking-tighter text-gray-900">
                  {book.name}
                </h2>
              </Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
};

export default Books;
