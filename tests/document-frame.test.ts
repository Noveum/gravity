import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { safeDocumentHtml } from "@/components/files/document-frame";

it("preserves document formatting while removing scripts and blocking external requests", () => {
  const dom = new JSDOM("");
  const purifier = DOMPurify(dom.window);
  const html = safeDocumentHtml(
    '<style>p{font-weight:bold}</style><p onclick="alert(1)">Saved</p><script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/tracker"><img src="data:image/png;base64,AAAA">',
    purifier,
  );
  expect(html).toContain("font-weight:bold");
  expect(html).toContain("Saved");
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("data:image/png");
  expect(html).not.toContain("onclick");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("https://example.com");
  dom.window.close();
});
