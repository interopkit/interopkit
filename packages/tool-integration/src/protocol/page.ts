import type { HttpResponse } from "@interopkit/core/http";
import { pagePolicy } from "./html.js";

/** What a page that one script drives consists of. */
export interface PageOptions {
  /** The HTML of the body, before the script: the forms and the elements that the script reads. */
  readonly body: string;
  /** The text of the one script, which the policy of the page names by its hash. */
  readonly script: string;
  /** The sources that a form of the page may submit to: `'self'` or an origin. */
  readonly formAction: string;
  /**
   * The origin that may frame the page; the policy leaves out `frame-ancestors` when there is none to name.
   *
   * @defaultValue none
   */
  readonly frameAncestors?: string;
}

/**
 * Builds the answer for a page with one script, which the login and the launch send to a browser: it is not cached, sends no
 * referrer, is not sniffed, and its policy allows nothing but its script, by hash, and the forms that go to
 * `formAction`. The caller has encoded every value in `body` with `escapeHtml`.
 */
export async function renderPage(page: PageOptions): Promise<HttpResponse> {
  const { body, script, formAction, frameAncestors } = page;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LTI launch</title>
</head>
<body>
${body}<script>${script}</script>
</body>
</html>
`;
  return {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": await pagePolicy(script, formAction, frameAncestors),
    },
    body: html,
  };
}
