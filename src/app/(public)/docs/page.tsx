import { siteCopy as t } from "@crm/public-site/content";
import { publicMetadata } from "@crm/public-site/metadata";
import Link from "next/link";
export const metadata = publicMetadata(t.docsTitle, t.docsDescription, "/docs");
export default function Page() {
  return (
    <main id="public-main" tabIndex={-1} className="site-index">
      <header>
        <p className="site-eyebrow">{t.previewBadge}</p>
        <h1>{t.docsTitle}</h1>
        <p className="site-lede">{t.docsDescription}</p>
      </header>
      <div className="site-article-grid">
        {t.docs.map((item) => (
          <article key={item.slug}>
            <h2>
              <Link href={`/docs/${item.slug}`}>{item.title}</Link>
            </h2>
            <p>{item.description}</p>
            <Link href={`/docs/${item.slug}`}>{t.readArticle}</Link>
          </article>
        ))}
      </div>
    </main>
  );
}
