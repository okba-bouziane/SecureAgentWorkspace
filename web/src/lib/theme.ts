import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function useTheme(): [Theme, () => void] {
  const prefers = () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme | undefined) ?? prefers());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("saw-theme", next);
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return [theme, toggle];
}
