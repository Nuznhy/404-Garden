import { localizePath, type Locale } from "../i18n";

const gardenPathsByLocale = {
  en: [
    {
      href: "/cv/",
      label: "The Gardener's Record",
      code: "cv/",
      description: "curriculum vitae, skills, experience",
    },
    {
      href: "/projects/",
      label: "Specimens",
      code: "projects/",
      description: "software projects and experiments",
    },
    {
      href: "/notes/",
      label: "Field Notes",
      code: "notes/",
      description: "technical notes and observations",
    },
    {
      href: "/links/",
      label: "External Vines",
      code: "links/",
      description: "places worth visiting",
    },
    {
      href: "/now/",
      label: "Currently Growing",
      code: "now.html",
      description: "what is active right now",
    },
  ],
  uk: [
    {
      href: "/cv/",
      label: "Запис садівника",
      code: "cv/",
      description: "резюме, навички, досвід",
    },
    {
      href: "/projects/",
      label: "Зразки",
      code: "projects/",
      description: "програмні проєкти та експерименти",
    },
    {
      href: "/notes/",
      label: "Польові нотатки",
      code: "notes/",
      description: "технічні нотатки та спостереження",
    },
    {
      href: "/links/",
      label: "Зовнішні ліани",
      code: "links/",
      description: "місця, які варто відвідати",
    },
    {
      href: "/now/",
      label: "Зараз росте",
      code: "now.html",
      description: "що активне саме зараз",
    },
  ],
} satisfies Record<
  Locale,
  Array<{
    href: string;
    label: string;
    code: string;
    description: string;
  }>
>;

export function getGardenPaths(locale: Locale) {
  return gardenPathsByLocale[locale].map((path) => ({
    ...path,
    href: localizePath(path.href, locale),
  }));
}
