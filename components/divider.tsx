import { FC } from "react";

type DividerProps = {
  label?: string;
};

export const Divider: FC<DividerProps> = ({ label }) => {
  return (
    <div className="-my-2.5 flex h-5 items-center">
      <hr className="flex-1 border-t border-gray-300" />
      {label ? <span className="px-2 text-sm text-gray-500">{label}</span> : null}
      <hr className="flex-1 border-t border-gray-300" />
    </div>
  );
};
