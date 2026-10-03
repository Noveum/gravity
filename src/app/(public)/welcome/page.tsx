import { siteCopy as t } from "@crm/public-site/content";
import { publicMetadata } from "@crm/public-site/metadata";
import {
  ArrowRight,
  Check,
  Command,
  GitBranch,
  MessageSquare,
  Orbit,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
export const metadata = publicMetadata(
  t.heroTitle,
  t.heroDescription,
  "/welcome",
);
const icons = [MessageSquare, GitBranch, ShieldCheck, Command];
export default function Page() {
  return (
    <main id="public-main" tabIndex={-1}>
      <section className="site-hero">
        <div className="site-hero-copy">
          <span className="site-badge">
            <span />
            {t.previewBadge}
          </span>
          <p className="site-eyebrow">{t.eyebrow}</p>
          <h1>{t.heroTitle}</h1>
          <p className="site-lede">{t.heroDescription}</p>
          <div className="site-actions">
            <Link className="site-button" href="/">
              {t.tryDemo}
              <ArrowRight size={16} />
            </Link>
            <Link
              className="site-button site-secondary"
              href="/docs/getting-started"
            >
              {t.readSetup}
            </Link>
          </div>
          <p className="site-note">{t.heroNote}</p>
        </div>
        <div className="site-orbit-art" aria-hidden="true">
          <Orbit size={130} />
          <span />
          <span />
        </div>
      </section>
      <section className="site-preview" aria-label={t.previewLabel}>
        <div className="site-preview-bar">
          <Sparkles size={16} />
          <strong>{t.previewOrg}</strong>
          <span>{t.previewProduct}</span>
          <span className="site-preview-key">
            <Command size={12} />K
          </span>
        </div>
        <div className="site-preview-body">
          <div className="site-preview-list">
            <h2>{t.previewQueue}</h2>
            <small>{t.previewToday}</small>
            {t.previewTasks.map((task, index) => (
              <div
                className={`site-preview-task ${index === 0 ? "selected" : ""}`}
                key={task.name}
              >
                <span className="site-preview-avatar">
                  {task.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
                <div>
                  <strong>{task.name}</strong>
                  <span>{task.company}</span>
                  <p>{task.task}</p>
                  <small>{task.label}</small>
                </div>
                <time>{task.time}</time>
              </div>
            ))}
          </div>
          <aside className="site-preview-context">
            <span className="site-eyebrow">{t.previewContext}</span>
            <h3>{t.previewTasks[0].name}</h3>
            <span className="site-badge">{t.previewProduct}</span>
            <blockquote>{t.previewMessage}</blockquote>
            <p>{t.previewHistory}</p>
          </aside>
        </div>
        <p className="site-preview-caption">
          {t.previewCaption}
          <span>{t.previewLabel}</span>
        </p>
      </section>
      <section id="product" className="site-section">
        <p className="site-eyebrow">{t.featureEyebrow}</p>
        <h2>{t.featureTitle}</h2>
        <div className="site-feature-grid">
          {t.features.map((feature, index) => {
            const Icon = icons[index];
            return (
              <article key={feature.title}>
                <Icon size={22} />
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>
      <section className="site-section site-assistant">
        <div>
          <p className="site-eyebrow">{t.mcpEyebrow}</p>
          <h2>{t.mcpTitle}</h2>
          <p>{t.mcpDescription}</p>
          <Link className="site-inline-link" href="/docs/connect-an-assistant">
            {t.mcpLink}
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="site-prompt">
          <Sparkles size={22} />
          <blockquote>{t.mcpPrompt}</blockquote>
          <p>{t.mcpBoundary}</p>
        </div>
      </section>
      <section className="site-section">
        <h2>{t.statusTitle}</h2>
        <p className="site-section-intro">{t.statusDescription}</p>
        <div className="site-status-grid">
          <article>
            <h3>{t.readyTitle}</h3>
            <ul>
              {t.readyItems.map((item) => (
                <li key={item}>
                  <Check size={15} />
                  {item}
                </li>
              ))}
            </ul>
          </article>
          <article>
            <h3>{t.nextTitle}</h3>
            <ul>
              {t.nextItems.map((item) => (
                <li key={item}>
                  <span className="site-pending-dot" />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>
      <section className="site-section">
        <div className="site-section-heading">
          <div>
            <h2>{t.journalTitle}</h2>
            <p>{t.journalDescription}</p>
          </div>
          <Link href="/blog">
            {t.allArticles}
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="site-article-grid">
          {t.articles.map((article) => (
            <article key={article.slug}>
              <p className="site-eyebrow">{t.articleDate}</p>
              <h3>
                <Link href={`/blog/${article.slug}`}>{article.title}</Link>
              </h3>
              <p>{article.description}</p>
              <Link className="site-inline-link" href={`/blog/${article.slug}`}>
                {t.readArticle}
                <ArrowRight size={14} />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="site-section site-faq">
        <h2>{t.faqTitle}</h2>
        {t.faqs.map((faq) => (
          <details key={faq.question}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </section>
      <section className="site-section site-final">
        <h2>{t.finalTitle}</h2>
        <p>{t.finalDescription}</p>
        <div className="site-actions">
          <Link className="site-button" href="/docs/getting-started">
            {t.readSetup}
            <ArrowRight size={16} />
          </Link>
          <a
            className="site-button site-secondary"
            href="https://github.com/Noveum/gravity"
          >
            {t.source}
          </a>
        </div>
      </section>
    </main>
  );
}
