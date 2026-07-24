import type { FC } from "react";

export const NotFound: FC = () => {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <h1 className="font-bold text-4xl">404</h1>
      <p className="mt-2 text-gray-500">Page not found</p>
    </div>
  );
};
