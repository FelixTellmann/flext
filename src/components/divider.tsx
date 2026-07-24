import type { FC } from "react";

type DividerProps = {
  label?: string;
};

export const Divider: FC<DividerProps> = ({ label }) => {
  return (
    <div className="-my-2.5 flex h-5 items-center">
      <hr className="flex-1 border-gray-300 border-t" />
      {label ? <span className="px-2 text-gray-500 text-sm">{label}</span> : null}
      <hr className="flex-1 border-gray-300 border-t" />
    </div>
  );
};
