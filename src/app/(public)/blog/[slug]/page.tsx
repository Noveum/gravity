import { findArticle, siteCopy } from "@crm/public-site/content";
import { publicMetadata } from "@crm/public-site/metadata";
import { notFound } from "next/navigation";
import { Article } from "@/components/public-site/article";
export function generateStaticParams() {
  return siteCopy.articles.map((item) => ({ slug: item.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = findArticle("articles", slug);
  if (!article) notFound();
  return publicMetadata(article.title, article.description, `/blog/${slug}`);
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const article = findArticle("articles", (await params).slug);
  if (!article) notFound();
  return <Article article={article} kind="blog" />;
}
