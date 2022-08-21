import clsx from "clsx";
import { FC } from "react";

export const ButtonLoading: FC<{ className?: string }> = ({ className }) => {
  return (
    <>
      <div className={clsx("absolute inset-0 bg-inherit", className)} />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 2"
        preserveAspectRatio="xMidYMid"
        className="absolute left-1/2 top-1/2 h-full w-14 -translate-x-1/2 -translate-y-1/2"
      >
        <g transform="translate(20 1)">
          <circle cx="0" cy="0" r="6" fill="currentColor">
            <animateTransform
              attributeName="transform"
              type="scale"
              begin="-0.375s"
              calcMode="spline"
              keySplines="0.3 0 0.7 1;0.3 0 0.7 1"
              values="0;1;0"
              keyTimes="0;0.5;1"
              dur="1s"
              repeatCount="indefinite"
            ></animateTransform>
          </circle>
        </g>
        <g transform="translate(40 1)">
          <circle cx="0" cy="0" r="6" fill="currentColor">
            <animateTransform
              attributeName="transform"
              type="scale"
              begin="-0.25s"
              calcMode="spline"
              keySplines="0.3 0 0.7 1;0.3 0 0.7 1"
              values="0;1;0"
              keyTimes="0;0.5;1"
              dur="1s"
              repeatCount="indefinite"
            ></animateTransform>
          </circle>
        </g>
        <g transform="translate(60 1)">
          <circle cx="0" cy="0" r="6" fill="currentColor">
            <animateTransform
              attributeName="transform"
              type="scale"
              begin="-0.125s"
              calcMode="spline"
              keySplines="0.3 0 0.7 1;0.3 0 0.7 1"
              values="0;1;0"
              keyTimes="0;0.5;1"
              dur="1s"
              repeatCount="indefinite"
            ></animateTransform>
          </circle>
        </g>
        <g transform="translate(80 1)">
          <circle cx="0" cy="0" r="6" fill="currentColor">
            <animateTransform
              attributeName="transform"
              type="scale"
              begin="0s"
              calcMode="spline"
              keySplines="0.3 0 0.7 1;0.3 0 0.7 1"
              values="0;1;0"
              keyTimes="0;0.5;1"
              dur="1s"
              repeatCount="indefinite"
            ></animateTransform>
          </circle>
        </g>
      </svg>
    </>
  );
};
