import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownPreview({ body }: { readonly body: string }) {
  return (
    <article className="min-w-0 break-words text-dense text-text [&_a]:text-accent [&_a]:underline [&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_h1]:my-4 [&_h1]:font-semibold [&_h1]:text-2xl [&_h2]:my-3 [&_h2]:font-semibold [&_h2]:text-xl [&_h3]:my-3 [&_h3]:font-medium [&_h3]:text-lg [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-surface-2 [&_pre]:p-4 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: ({ src, alt }) => (
            <a
              href={typeof src === "string" ? src : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              {alt || "Image"}
            </a>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </Markdown>
    </article>
  );
}
