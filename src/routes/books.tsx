import { createFileRoute, createServerFn } from "@tanstack/react-start";
import { HeartIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { Image } from "~/components/image";
import { Link } from "~/components/link";
import { orpc } from "~/integrations/orpc";
import { type FC, useCallback, useState } from "react";
import shortUUID from "short-uuid";

type Book = {
  id: string;
  createdAt: string;
  updatedAt: string;
  read: boolean;
  published: boolean;
  name: string;
  asin: string | null;
  isbn10: string | null;
  author: string | null;
  author_url: string | null;
  image: string | null;
  url: string | null;
  rating: number;
  votes: number;
};

const fetchBooks = createServerFn({ method: "GET" }).handler(async () => {
  const data = await orpc.books.get();
  return data.map((book) => ({
    ...book,
    createdAt: new Date(book.createdAt).toUTCString(),
    updatedAt: new Date(book.updatedAt).toUTCString(),
  }));
});

export const Route = createFileRoute("/books")({
  loader: async () => {
    const books = await fetchBooks();
    return { books };
  },
  component: BooksPage,
});

const StarRating: FC<{ rating: number }> = ({ rating }) => {
  const gradientId = shortUUID.generate();

  return (
    <figure className="flex h-[22px] items-center justify-center">
      {[...new Array(5)].map((_, index) => {
        const percentage = rating / (index + 1) >= 1 ? 100 : Math.max((rating - index) * 100, 0);
        return (
          <svg
            key={`${gradientId}-${index}`}
            className="h-full w-auto"
            fill={`url(#${gradientId}-${index})`}
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
            <linearGradient id={`${gradientId}-${index}`}>
              <stop offset="0%" className={clsx("[stop-color:theme(colors.yellow.500)]")} />
              <stop
                offset={`${percentage}%`}
                className={clsx("[stop-color:theme(colors.yellow.500)]")}
              />
              <stop
                offset={`${percentage}%`}
                className={clsx("[stop-color:theme(colors.gray.300)]")}
              />
              <stop offset="100%" className={clsx("[stop-color:theme(colors.gray.300)]")} />
            </linearGradient>
          </svg>
        );
      })}
    </figure>
  );
};

const BookItem = (props: { book: Book; preload: boolean }) => {
  const [book, setBook] = useState({ ...props.book, upvoted: false });

  const addVote = useCallback(async (id: string) => {
    setBook((book) => ({
      ...book,
      votes: book.votes + 1,
      upvoted: true,
    }));
    orpc.books.upvote({ id });
  }, []);

  return (
    <figure className="group spacing-2">
      <div className="relative grid">
        <picture className="aspect-[0.666] overflow-hidden rounded-md drop-shadow">
          <Image
            preload={props.preload}
            src={book.image ?? ""}
            maxWidth={360}
            width={360}
            height={549}
            alt={book.name}
            className="-m-0.5 h-[calc(100%+0.25rem)] w-[calc(100%+0.25rem)] max-w-none object-cover object-center group-hfa:saturate-150"
          />
        </picture>
        <footer className="absolute -bottom-2 right-4 flex gap-2">
          {book.rating
            ? <div className="rounded-md bg-white py-1 px-2 drop-shadow-md">
                <StarRating rating={book.rating} />
              </div>
            : null}
          <button
            className="flex items-center justify-center gap-1 rounded-md bg-white py-1 px-1.5 text-gray-300 drop-shadow-md transition-all h:text-red-500"
            disabled={book.upvoted}
            onClick={() => addVote(book.id)}
          >
            <HeartIcon className="h-5 w-5 " />
            <span className="text-sm font-semibold">{book.votes}</span>
          </button>
        </footer>
      </div>
      <figcaption className="">
        <h2>
          <Link
            href={book.url ?? ""}
            className="text-[15px] font-semibold text-gray-900 hfa:underline d:text-gray-100"
          >
            {book.name}
          </Link>
        </h2>
        <h3>
          {" "}
          <Link
            href={book.author_url ?? ""}
            className="text-[15px] tracking-tight text-gray-900 hfa:underline d:text-gray-400"
          >
            {book.author}
          </Link>
        </h3>
      </figcaption>
    </figure>
  );
};

function BooksPage() {
  const { books } = Route.useLoaderData();

  return (
    <>
      <section className="relative mx-auto max-w-6xl px-4 py-16 md:px-8">
        <header className="pb-16">
          <div className="heading-pre">Reading list</div>
          <h1 className="heading-2xl -ml-1">Collection of books that I've read</h1>
          <div className="relative -mx-4 overflow-x-auto px-4 pb-2">
            {/*<fieldset
              className="flex gap-3"
              onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
            >
              <legend className="sr-only">Filter by Tag</legend>
              {["All Projects", ...new Set(PROJECTS.map((p) => p.type).flat())].map((type, index) => {
                return (
                  <label key={type} className="flex">
                    <input
                      type="radio"
                      className="peer hidden"
                      defaultChecked={index === 0}
                      name="Tag Filter"
                      value={type}
                    />
                    <div className="cursor-pointer appearance-none whitespace-nowrap rounded-full border border-gray-200 bg-gray-400/10 py-1 px-3 text-[13px] font-medium text-gray-400 transition-colors peer-checked:text-gray-900 hfa:text-gray-500 d:border-gray-700 d:peer-checked:text-gray-50 d:hfa:text-gray-300">
                      {type}
                    </div>
                  </label>
                );
              })}
            </fieldset>*/}
          </div>
        </header>
        <main className="grid w-full grid-cols-2 gap-8 gap-y-16 sm:gap-16 sm:gap-y-24 md:grid-cols-3">
          {books
            .sort((a, b) => b.votes - a.votes)
            .map((book, index) => (
              <BookItem book={book} key={book.id} preload={index < 10} />
            ))}
        </main>
      </section>
    </>
  );
}
