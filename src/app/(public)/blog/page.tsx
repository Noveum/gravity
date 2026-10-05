import { siteCopy as t } from "@crm/public-site/content";
import { publicMetadata } from "@crm/public-site/metadata";
import Link from "next/link";
export const metadata = publicMetadata(t.blogTitle, t.blogDescription, "/blog");
export default function Page() {
  return (
    <main id="public-main" tabIndex={-1} className="site-index">
      <header>
        <p className="site-eyebrow">{t.author}</p>
        <h1>{t.blogTitle}</h1>
        <p className="site-lede">{t.blogDescription}</p>
      </header>
      <div className="site-article-grid">
        {t.articles.map((item) => (
          <article key={item.slug}>
            <time dateTime="2026-10-04">{t.articleDate}</time>
            <h2>
              <Link href={`/blog/${item.slug}`}>{item.title}</Link>
            </h2>
            <p>{item.description}</p>
            <Link href={`/blog/${item.slug}`}>{t.readArticle}</Link>
          </article>
        ))}
      </div>
    </main>
  );
}
