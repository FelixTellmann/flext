import { createContext, Dispatch, SetStateAction, useContext, useMemo, useState } from "react";

export function makeStore<S>(defaultValue: S, displayName = "") {
  // Make a context for the store
  const context = createContext<[S, Dispatch<SetStateAction<S>>]>([defaultValue, () => {}]);

  if (displayName !== "") {
    context.displayName = displayName;
  }

  // Make a provider that takes an initialValue
  const Provider = ({ init = defaultValue, children }: { children: any; init?: S }) => {
    // Make a new state instance
    const [state, setState] = useState<S>(init);

    // Bind the actions with the old state and args
    // const boundActions = {};
    // Object.keys(actions).forEach(key => {
    //   boundActions[key] = (...args) => setState(old => actions[key](old, ...args));
    // });
    // const contextValue = useMemo(() => [state, boundActions], [state]);
    // Memoize the context value to update when the state does

    const contextValue = useMemo<[S, Dispatch<SetStateAction<S>>]>(
      () => [state, setState],
      [state]
    );
    // Provide the store to children
    return <context.Provider value={contextValue}>{children}</context.Provider>;
  };

  // A hook to help us consume the store
  const useStore = () => useContext<[S, Dispatch<SetStateAction<S>>]>(context);

  return { Provider, useStore };
}
