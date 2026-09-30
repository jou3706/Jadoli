"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setFormatLang, type Lang } from "./utils";

type I18nValue = {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** tr(`عربي`, `English`) */
  tr: (ar: string, en: string) => string;
};

const I18nContext = createContext<I18nValue>({
  lang: "ar",
  dir: "rtl",
  setLang: () => {},
  toggle: () => {},
  tr: (ar) => ar,
});

const LANG_KEY = "jadoli_lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    let initial: Lang = "ar";
    try {
      initial = localStorage.getItem(LANG_KEY) === "en" ? "en" : "ar";
    } catch {
      /* ignore */
    }
    setLangState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    setFormatLang(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const toggle = useCallback(
    () => setLangState((p) => (p === "ar" ? "en" : "ar")),
    [],
  );

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir,
      setLang,
      toggle,
      tr: (ar: string, en: string) => (lang === "en" ? en : ar),
    }),
    [lang, dir, setLang, toggle],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useTr = () => useContext(I18nContext).tr;
