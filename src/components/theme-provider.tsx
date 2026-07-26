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
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState("light");
  const [mounted, setMounted] = useState(false);

  // The stored theme is read after mount, never during render: the server cannot know it, so reading
  // it during the first client render would disagree with the server output and trip hydration.
  // Colours do not flash meanwhile — the anti-flash script in __root has already dressed <html>.
  useEffect(() => {
    setThemeState(getInitialTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme, mounted]);

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
