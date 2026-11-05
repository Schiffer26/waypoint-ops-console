/**
 * Adaptive theming — resolves the persisted appearance preference against
 * the OS. In SYSTEM mode the console tracks Windows light/dark changes live
 * (Chromium's prefers-color-scheme follows nativeTheme). Manual LIGHT/DARK
 * selections override the OS. The resolved theme is applied as
 * `data-theme` on <html>, driving the semantic token layer in index.css.
 */
import { useEffect, useState } from "react";
import type { ThemeMode } from "@/types";
import { useOpsStore } from "@/store/useOpsStore";

export type ResolvedTheme = "light" | "dark";

function systemIsDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(mode: ThemeMode, dark: boolean): ResolvedTheme {
  return mode === "system" ? (dark ? "dark" : "light") : mode;
}

/** Live OS dark-mode flag (re-subscribes when the OS flips). */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(systemIsDark);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/**
 * Applies the current theme to the document and returns the resolved value.
 * Mount once at the app root (main console and briefing window each mount it).
 */
export function useThemeSync(): ResolvedTheme {
  const mode = useOpsStore((s) => s.settings.theme);
  const dark = useSystemDark();
  const resolved = resolveTheme(mode, dark);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return resolved;
}
