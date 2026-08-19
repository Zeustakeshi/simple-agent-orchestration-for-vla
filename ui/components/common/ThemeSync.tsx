"use client";
/* ThemeSync — keeps <html data-theme> in step with the stored preference.

   The first paint is already handled by the inline script in app/layout.tsx;
   this component covers what happens afterwards: React hydrating with the
   stored value, and the OS switching appearance while "Theo hệ thống" is on. */

import { useEffect } from "react";
import { useUiPreferenceStore, applyTheme, readStoredTheme } from "@/stores";

export function ThemeSync() {
  const theme = useUiPreferenceStore((s) => s.theme);

  // Adopt the stored preference on mount (the store starts at the SSR default).
  useEffect(() => {
    const stored = readStoredTheme();
    if (stored !== useUiPreferenceStore.getState().theme) {
      useUiPreferenceStore.setState({ theme: stored });
    }
    applyTheme(stored);
  }, []);

  // Follow the OS only while the preference is "system".
  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
