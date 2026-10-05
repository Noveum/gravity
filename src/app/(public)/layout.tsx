import t from "@crm/i18n/translations/en.json";
import { siteCopy as copy } from "@crm/public-site/content";
import {
  deploymentGuide,
  gravityRepository,
} from "@crm/public-site/deployment";
import { LogIn } from "lucide-react";
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
        <Link href="/" className="site-brand" aria-label={copy.brandHome}>
          <GravityMark size={32} />
          {t.brand}
        </Link>
        <nav aria-label={copy.navLabel}>
          <Link href="/#product">{copy.product}</Link>
          <Link href={deploymentGuide}>{copy.deployNav}</Link>
          <Link href="/docs">{copy.docsLabel}</Link>
          <Link href="/blog">{copy.blogLabel}</Link>
          <a href={gravityRepository}>{copy.source}</a>
        </nav>
        <div className="site-header-actions">
          <Preferences showDensity={false} />
          <Link className="site-button site-button-small" href="/sign-in">
            <LogIn size={14} aria-hidden="true" />
            {copy.signIn}
          </Link>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <span>{copy.footer}</span>
        <Link href={deploymentGuide}>{copy.deployWithVercel}</Link>
        <a href={gravityRepository}>{copy.source}</a>
      </footer>
    </div>
  );
}
