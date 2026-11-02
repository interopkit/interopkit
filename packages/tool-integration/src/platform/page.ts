import type { HttpResponse } from "@interopkit/core/http";
import { escapeHtml, renderPage } from "../protocol/internal.js";

// The form submits itself; requestSubmit runs the form's validation and its submit event, which submit() does not.
const SCRIPT = `document.getElementById("form").requestSubmit();`;

/** What the page posts and to whom. */
export interface AutoPost {
  /** The tool's redirect URI, to which the page posts the form. */
  readonly redirectUri: string;
  /** The fields of the form, in order: the `id_token` and `state`, or the `error` of an authentication error response. */
  readonly fields: readonly (readonly [string, string])[];
  /** The origin of the page that frames this one, the only one that may. */
  readonly frameOrigin: string;
  /** The status of the answer: 200 for an `id_token`, the status of the refusal for an error. */
  readonly status: number;
}

/**
 * Builds the page that posts a form to the tool's redirect URI (Security Framework section 5.1.1.3 and 5.1.1.5,
 * `response_mode=form_post`). The page has a policy that allows its one script by hash, forms only to the origin of the
 * redirect URI and framing only by the host's frame page, because the tool's frame is same-origin with the platform's pages on
 * the platform's origin; every value in it is HTML-encoded; and the answer is not cached and sends no referrer.
 */
export async function autoPostPage(post: AutoPost): Promise<HttpResponse> {
  const { redirectUri, fields, frameOrigin, status } = post;
  const inputs = fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">\n`)
    .join("");
  const body = `<form id="form" method="post" action="${escapeHtml(redirectUri)}">
${inputs}<noscript><button type="submit">Continue</button></noscript>
</form>
`;
  const page = await renderPage({
    body,
    script: SCRIPT,
    formAction: new URL(redirectUri).origin,
    frameAncestors: frameOrigin,
  });
  return { ...page, status };
}
