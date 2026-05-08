import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LIGHT,
  DARK,
  THEMES,
  TYPE_PAIRING_NATIVE,
  type Theme,
  themeToCssVars,
  pairingToCssVars,
} from "./tokens";
import { useThemePreference, type ThemePreference } from "../state/preferences";

export type { ThemePreference };

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function detectSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: ReactNode;
  // Phase 11 reads from persisted preferences. Tests that want to pin
  // a specific theme can still pass `initialPreference` to override
  // the persisted value for the lifetime of the provider.
  initialPreference?: ThemePreference;
}) {
  const [persisted, setPersisted] = useThemePreference();
  const [preference, setPreferenceLocal] = useState<ThemePreference>(
    initialPreference ?? persisted,
  );
  const setPreference = (p: ThemePreference) => {
    setPreferenceLocal(p);
    setPersisted(p);
  };
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(detectSystemTheme);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: Theme = useMemo(() => {
    if (preference === "system") return systemTheme === "dark" ? DARK : LIGHT;
    return THEMES[preference];
  }, [preference, systemTheme]);

  // Apply the theme + type pairing as CSS custom properties on the root
  // element. This is the single point where the design tokens become
  // observable styles.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const themeVars = themeToCssVars(resolved);
    const pairingVars = pairingToCssVars(TYPE_PAIRING_NATIVE);
    for (const [k, v] of Object.entries(themeVars)) root.style.setProperty(k, v);
    for (const [k, v] of Object.entries(pairingVars)) root.style.setProperty(k, v);
    root.dataset.theme = resolved.name;
  }, [resolved]);

  // setPreference is a stable closure (it captures setPreferenceLocal +
  // setPersisted, both stable), so omitting it from deps is safe.
  const value = useMemo(
    () => ({ theme: resolved, preference, setPreference }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
