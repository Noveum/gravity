import t from "../i18n/translations/en.json";
export const siteCopy = t.publicSite;
export type Article = (typeof siteCopy.docs)[number];
export const publicPaths = [
  "/welcome",
  "/docs",
  "/blog",
  ...siteCopy.docs.map((item) => `/docs/${item.slug}`),
  ...siteCopy.articles.map((item) => `/blog/${item.slug}`),
];
export function findArticle(kind: "docs" | "articles", slug: string) {
  return siteCopy[kind].find((item) => item.slug === slug);
}
