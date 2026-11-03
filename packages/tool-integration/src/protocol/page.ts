import type { HttpResponse } from "@interopkit/core/http";
import { escapeHtml, pagePolicy } from "./html.js";

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
  /**
   * The referrer policy of the page. A page whose form posts to its own origin, which the receiver checks, takes
   * `same-origin`: under `no-referrer` a browser sends the `Origin` of a form post as `null` (Fetch, "append a request
   * `Origin` header").
   *
   * @defaultValue `"no-referrer"`
   */
  readonly referrerPolicy?: "no-referrer" | "same-origin";
}

/**
 * Builds the answer for a page with one script, which the login and the launch send to a browser: it is not cached, sends no
 * referrer, or one to its own origin alone, is not sniffed, and its policy allows nothing but its script, by hash, and the forms
 * that go to `formAction`. The caller has encoded every value in `body` with `escapeHtml`.
 */
export async function renderPage(page: PageOptions): Promise<HttpResponse> {
  const { body, script, formAction, frameAncestors, referrerPolicy = "no-referrer" } = page;
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
      "referrer-policy": referrerPolicy,
      "x-content-type-options": "nosniff",
      "content-security-policy": await pagePolicy(script, formAction, frameAncestors),
    },
    body: html,
  };
}

// The form submits itself; requestSubmit runs the form's validation and its submit event, which submit() does not.
const POST_SCRIPT = `document.getElementById("form").requestSubmit();`;

/** What a page that posts a form to another party consists of. */
export interface PostPage {
  /** The address to which the page posts the form: an `https` URL. */
  readonly action: string;
  /** The fields of the form, in order, as hidden inputs. */
  readonly fields: readonly (readonly [string, string])[];
  /**
   * The origin that may frame the page; the policy leaves out `frame-ancestors` when there is none to name.
   *
   * @defaultValue none
   */
  readonly frameAncestors?: string;
}

/**
 * Builds the page that posts a form of hidden fields to an address as soon as it loads, for a message that has to go from the
 * browser to the other party (Security Framework sections 5.1.1.3 and 5.2.2: `form_post` and the `JWT` of a tool's message). Its
 * policy allows its one script by hash and forms only to the origin of the address, every value in it is HTML-encoded, and it
 * is not cached and sends no referrer.
 */
export function renderPostPage(post: PostPage): Promise<HttpResponse> {
  const { action, fields, frameAncestors } = post;
  const inputs = fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">\n`)
    .join("");
  const body = `<form id="form" method="post" action="${escapeHtml(action)}">
${inputs}<noscript><button type="submit">Continue</button></noscript>
</form>
`;
  return renderPage({
    body,
    script: POST_SCRIPT,
    formAction: new URL(action).origin,
    ...(frameAncestors === undefined ? {} : { frameAncestors }),
  });
}
