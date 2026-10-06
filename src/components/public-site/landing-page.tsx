import { siteCopy as t } from "@crm/public-site/content";
import {
  deploymentGuide,
  gravityRepository,
} from "@crm/public-site/deployment";
import {
  ArrowRight,
  Check,
  Command,
  GitBranch,
  Globe,
  MessageSquare,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { GravityMark } from "@/components/gravity-logo";
import { DeployButton } from "./deploy-button";
import { ProductTour } from "./product-tour";

const icons = [MessageSquare, GitBranch, ShieldCheck, Command];
export function LandingPage() {
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
            <Link className="site-button" href="/sign-in">
              {t.signInToGravity}
              <ArrowRight size={16} />
            </Link>
            <DeployButton />
          </div>
          <p className="site-note">{t.heroNote}</p>
          <a className="site-inline-link" href={gravityRepository}>
            <GitBranch size={14} aria-hidden="true" />
            {t.viewSource}
          </a>
        </div>
        <div className="site-orbit-art" aria-hidden="true">
          <GravityMark size={130} />
          <span />
          <span />
        </div>
      </section>
      <ProductTour />
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
      <section className="site-section site-workflow">
        <p className="site-eyebrow">{t.workflowEyebrow}</p>
        <h2>{t.workflowTitle}</h2>
        <ol>
          {t.workflowSteps.map((step, index) => (
            <li key={step.title}>
              <span className="site-workflow-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="site-section site-privacy">
        <div>
          <p className="site-eyebrow">{t.privacyEyebrow}</p>
          <h2>{t.privacyTitle}</h2>
          <p>{t.privacyDescription}</p>
          <Link className="site-inline-link" href="/docs/accounts-and-privacy">
            {t.privacyLink}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <div className="site-privacy-diagram" aria-hidden="true">
          <div>
            <MessageSquare size={22} />
            <span>{t.tourProviderLabels}</span>
          </div>
          <ShieldCheck size={28} />
          <div>
            <GravityMark size={30} />
            <span>{t.previewOrg}</span>
          </div>
          <p>{t.privacyTitle}</p>
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
      <section id="deploy" className="site-section site-deployment">
        <p className="site-eyebrow">{t.deploymentEyebrow}</p>
        <h2>{t.deploymentTitle}</h2>
        <p className="site-section-intro">{t.deploymentDescription}</p>
        <div className="site-deployment-grid">
          <article>
            <Globe size={23} aria-hidden="true" />
            <h3>{t.hostedTitle}</h3>
            <p>{t.hostedDescription}</p>
            <Link className="site-button" href="/sign-in">
              {t.signInToGravity}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <small>{t.hostedNote}</small>
          </article>
          <article>
            <Server size={23} aria-hidden="true" />
            <h3>{t.vercelTitle}</h3>
            <p>{t.vercelDescription}</p>
            <DeployButton />
            <Link className="site-inline-link" href={deploymentGuide}>
              {t.deploymentGuide}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <small>{t.vercelNote}</small>
          </article>
        </div>
      </section>
      <section className="site-section site-open-source">
        <p className="site-eyebrow">{t.openSourceEyebrow}</p>
        <h2>{t.openSourceTitle}</h2>
        <p className="site-section-intro">{t.openSourceDescription}</p>
        <div className="site-feature-grid site-open-grid">
          {t.openSourceValues.map((value) => (
            <article key={value.title}>
              <h3>{value.title}</h3>
              <p>{value.body}</p>
            </article>
          ))}
        </div>
        <a className="site-inline-link" href={gravityRepository}>
          {t.viewSource}
          <ArrowRight size={15} />
        </a>
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
          <Link className="site-button" href="/sign-in">
            {t.signInToGravity}
            <ArrowRight size={16} />
          </Link>
          <a className="site-button site-secondary" href={gravityRepository}>
            {t.viewSource}
          </a>
        </div>
      </section>
    </main>
  );
}
