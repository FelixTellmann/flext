import { trpc } from "components/_app/trpc";
import { fetchOnce } from "components/_hooks/use-trpc";
import { BOOKS } from "content/books";
import { FC, useCallback, useEffect } from "react";

type TestProps = {};

export const Test: FC<TestProps> = (props) => {
  const test = trpc.books.addMany.useMutation();
  const data = trpc.books.get.useQuery(undefined, { ...fetchOnce });

  /*const handleClick = useCallback(async () => {
    const data = await test.mutate(BOOKS.map((book) => ({ ...book, published: true })));
    console.log(data);
  }, [test]);

  useEffect(() => {
    console.log(data);
  }, [data]);*/

  return <>{/*<button onClick={handleClick}>ClickMe</button>*/}</>;
};

export default Test;
