import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import {
  findArticle,
  publicPaths,
  siteCopy,
} from "../packages/public-site/content";
import {
  canIndexPublicSite,
  publicMetadata,
  publicOrigin,
} from "../packages/public-site/metadata";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { LandingPage } from "../src/components/public-site/landing-page";

afterEach(() => vi.unstubAllEnvs());
test.each([
  "",
  "http://gravity.example.test",
  "https://user:secret@gravity.example.test",
  "https://gravity.example.test/private",
  "https://gravity.example.test/?token=x",
  "https://gravity.example.test/#x",
])("rejects an invalid marketing origin %s", (origin) => {
  vi.stubEnv("PUBLIC_SITE_URL", origin);
  vi.stubEnv("PUBLIC_SITE_INDEXING", "true");
  expect(publicOrigin()).toBeNull();
  expect(canIndexPublicSite()).toBe(false);
  expect(sitemap()).toEqual([]);
});
test("indexing requires an explicit production opt-in and never applies to previews", () => {
  vi.stubEnv("PUBLIC_SITE_URL", "https://gravity.example.test");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_SITE_INDEXING", "false");
  expect(canIndexPublicSite()).toBe(false);
  vi.stubEnv("PUBLIC_SITE_INDEXING", "true");
  vi.stubEnv("VERCEL_ENV", "preview");
  expect(canIndexPublicSite()).toBe(false);
  vi.stubEnv("VERCEL_ENV", "development");
  expect(canIndexPublicSite()).toBe(false);
  vi.stubEnv("VERCEL_ENV", "production");
  expect(canIndexPublicSite()).toBe(true);
  vi.stubEnv("NODE_ENV", "development");
  expect(canIndexPublicSite()).toBe(false);
});
test("production discovery includes only public content, keeping CRM and auth out", () => {
  vi.stubEnv("PUBLIC_SITE_URL", "https://gravity.example.test");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_SITE_INDEXING", "true");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(sitemap().map((item) => item.url)).toEqual(
    publicPaths.map((path) => `https://gravity.example.test${path}`),
  );
  expect(
    publicPaths.every(
      (path) => path === "/" || /^\/(docs|blog)(\/|$)/.test(path),
    ),
  ).toBe(true);
  expect(robots().rules).toEqual({
    userAgent: "*",
    allow: ["/$", "/docs", "/blog"],
    disallow: "/",
  });
  const metadata = publicMetadata("Example", "Description", "/docs");
  expect(metadata.alternates?.canonical).toBe(
    "https://gravity.example.test/docs",
  );
  expect(metadata.robots).toEqual({ index: true, follow: true });
});
test("unconfigured instances remain non-indexable and never invent a canonical URL", () => {
  vi.stubEnv("PUBLIC_SITE_URL", "");
  expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  expect(
    publicMetadata("Example", "Description", "/docs").alternates,
  ).toBeUndefined();
});
test("every content route has a unique slug and anchor; missing articles stay missing", () => {
  expect(new Set(publicPaths).size).toBe(publicPaths.length);
  for (const collection of [siteCopy.docs, siteCopy.articles]) {
    for (const article of collection) {
      expect(article.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(new Set(article.sections.map((section) => section.id)).size).toBe(
        article.sections.length,
      );
      for (const section of article.sections) {
        expect(section.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
        expect(section.paragraphs.length).toBeGreaterThan(0);
      }
    }
  }
  expect(findArticle("docs", "missing")).toBeUndefined();
  expect(findArticle("articles", "missing")).toBeUndefined();
});

test("the landing page sends its primary calls to action into the hosted workspace", () => {
  const html = renderToStaticMarkup(createElement(LandingPage));
  expect(html).toContain(siteCopy.heroTitle);
  expect(html).toContain(siteCopy.heroNote);
  expect((html.match(/href="\/actions"/g) ?? []).length).toBe(3);
  expect(html).not.toContain("Run Gravity locally");
  expect(html).not.toContain('href="/sign-in"');
});

test("getting started leads with hosted access and leaves development setup optional", () => {
  const guide = findArticle("docs", "getting-started");
  expect(guide?.sections[0].id).toBe("hosted");
  expect(guide?.sections[0].paragraphs.join(" ")).toContain(
    "https://gravity.noveum.ai",
  );
  expect(guide?.sections.at(-1)?.id).toBe("self-host");
});
