import { Transition } from "@headlessui/react";
import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";
import produce from "immer";
import { FC, Fragment } from "react";
import create from "zustand";

type ToastType = {
  id: string;
  timestamp: number;
  message: string;
  onDismiss?: (e: MouseEvent) => void;
  error?: boolean;
};

type ToastStore = {
  toasts: ToastType[];
  addToast: (notification: ToastType) => void;
  removeToast: (id: ToastType["id"]) => void;
};

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    set(
      produce((state) => {
        const currentToasts = state.toasts.filter(({ id }) => id !== toast.id);
        currentToasts.length = Math.min(currentToasts.length, 4);
        state.toasts = [...currentToasts, toast];
      })
    );

    setTimeout(
      () => {
        set((state) => {
          if (
            !state.toasts.some(
              ({ id, timestamp }) => id === toast.id && timestamp === toast.timestamp
            )
          ) {
            return state;
          }
          return {
            ...state,
            toasts: state.toasts.filter(
              ({ id, timestamp }) => id !== toast.id || timestamp !== toast.timestamp
            ),
          };
        });
      },
      2500
    );
  },
  removeToast: (id) => {
    set(
      produce((state) => {
        state.toasts = state.toasts.filter((toast) => id !== toast.id);
      })
    );
  },
}));

export const Toast: FC = ({}) => {
  const { toasts, removeToast } = useToast();

  return (
    <>
      <div
        aria-live="assertive"
        className="pointer-events-none fixed inset-0 z-20 flex items-end px-4 py-6 sm:p-6"
      >
        <div className="flex w-full flex-col items-center space-y-4">
          {[...new Array(5)].map((_, index) => {
            const toast = toasts[index];
            return (
              <Transition
                key={index}
                show={!!toasts[index]}
                as={Fragment}
                enter="transform ease-out duration-400 transition"
                enterFrom="translate-y-2 opacity-0 "
                enterTo="translate-y-0 opacity-100"
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <figure className="button-border pointer-events-auto flex w-full max-w-sm overflow-hidden rounded-lg border-gray-400/30 bg-white p-4 shadow-xl shadow-gray-500/10">
                  {toast?.error
                    ? <ExclamationCircleIcon className="h-6 w-6 text-red-400" aria-hidden="true" />
                    : <CheckCircleIcon className="h-6 w-6 text-green-400" aria-hidden="true" />}

                  <p className="ml-3 w-0 flex-1 pt-0.5 text-sm font-medium text-gray-900">
                    {toast?.message}
                  </p>

                  <button
                    className=" ml-4 flex inline-flex flex-shrink-0 rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    onClick={() => removeToast(toast?.id)}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </figure>
              </Transition>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default Toast;
