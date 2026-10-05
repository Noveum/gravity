import type { Article as ArticleContent } from "@crm/public-site/content";
import { siteCopy as t } from "@crm/public-site/content";
import Link from "next/link";
import { DeployButton } from "./deploy-button";
export function Article({
  article,
  kind,
}: {
  article: ArticleContent;
  kind: "docs" | "blog";
}) {
  return (
    <main id="public-main" tabIndex={-1} className="site-article">
      <Link className="site-back" href={`/${kind}`}>
        {kind === "docs" ? t.backDocs : t.backBlog}
      </Link>
      <header>
        <p className="site-eyebrow">
          {kind === "docs" ? t.docsLabel : t.author}
        </p>
        <h1>{article.title}</h1>
        <p className="site-lede">{article.description}</p>
        {kind === "docs" && article.slug === "deploy-on-vercel" && (
          <div className="site-actions">
            <DeployButton />
          </div>
        )}
        {kind === "blog" && <time dateTime="2026-10-04">{t.articleDate}</time>}
      </header>
      <div className="site-article-layout">
        <nav className="site-toc" aria-label={t.onThisPage}>
          <strong>{t.onThisPage}</strong>
          {article.sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
        <div className="site-prose">
          {article.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {"code" in section && section.code && (
                <pre>
                  <code>{section.code}</code>
                </pre>
              )}
            </section>
          ))}
          <aside className="site-related">
            <h2>{t.related}</h2>
            {(kind === "docs"
              ? t.docs.filter((item) => item.slug !== article.slug)
              : t.docs.slice(1)
            ).map((item) => (
              <Link key={item.slug} href={`/docs/${item.slug}`}>
                {item.title}
              </Link>
            ))}
          </aside>
        </div>
      </div>
    </main>
  );
}
