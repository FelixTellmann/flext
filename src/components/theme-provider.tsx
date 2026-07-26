import { createContext, type FC, type PropsWithChildren, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

type ThemeContextType = {
  theme: string;
  setTheme: (theme: Theme) => void;
  resolvedTheme: string;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

export const useTheme = () => useContext(ThemeContext);

function getSystemTheme(): string {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("theme") as Theme) || "system";
}

function resolveTheme(theme: Theme): string {
  if (theme === "system") return getSystemTheme();
  return theme;
}

// color-scheme must track the class: without it the UA keeps its light-mode defaults, so any text
// without an explicit colour renders black on the dark background (and so do native form controls).
function applyTheme(resolved: string) {
  const is_dark = resolved === "dark";
  document.documentElement.classList.toggle("dark", is_dark);
  document.documentElement.style.colorScheme = is_dark ? "dark" : "light";
}

export const ThemeProvider: FC<PropsWithChildren<{ attribute?: string }>> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getInitialTheme()));

  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const resolved = getSystemTheme();
        setResolvedTheme(resolved);
        applyTheme(resolved);
      }
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>{children}</ThemeContext.Provider>;
};
