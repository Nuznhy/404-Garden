import { en } from "./en";
import { uk } from "./uk";

export const defaultLocale = "en";

export const translations = {
  en,
  uk,
} as const;

export type Locale = keyof typeof translations;

export const locales = Object.keys(translations) as Locale[];

export function getLocaleFromUrl(url: URL): Locale {
  const [, locale] = url.pathname.split("/");

  if (locale && locale in translations) {
    return locale as Locale;
  }

  return defaultLocale;
}

export function useTranslations(locale: Locale) {
  return translations[locale] ?? translations[defaultLocale];
}

export function localizePath(path: string, locale: Locale): string {
  if (locale === defaultLocale) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `/${locale}${normalizedPath}`;
}
