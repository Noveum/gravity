import t from "@crm/i18n/translations/en.json";
import { siteCopy as copy } from "@crm/public-site/content";
import Link from "next/link";
import { GravityMark } from "@/components/gravity-logo";
import { Preferences } from "@/components/preferences";
import "./public.css";
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="public-site">
      <a className="site-skip" href="#public-main">
        {copy.skip}
      </a>
      <header className="site-header">
        <Link href="/welcome" className="site-brand">
          <GravityMark size={32} />
          {t.brand}
        </Link>
        <nav aria-label={copy.navLabel}>
          <Link href="/welcome#product">{copy.product}</Link>
          <Link href="/docs">{copy.docsLabel}</Link>
          <Link href="/blog">{copy.blogLabel}</Link>
          <a href="https://github.com/Noveum/gravity">{copy.source}</a>
        </nav>
        <Preferences showDensity={false} />
        <Link className="site-button site-button-small" href="/sign-in">
          {copy.openApp}
        </Link>
      </header>
      {children}
      <footer className="site-footer">
        <span>{copy.footer}</span>
        <Link href="/docs/deployment-readiness">{copy.previewBadge}</Link>
        <a href="https://github.com/Noveum/gravity">{copy.source}</a>
      </footer>
    </div>
  );
}
