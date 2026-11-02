import type { HttpResponse } from "@interopkit/core/http";
import { escapeHtml, renderPage } from "../protocol/internal.js";

// The form submits itself; requestSubmit runs the form's validation and its submit event, which submit() does not.
const SCRIPT = `document.getElementById("form").requestSubmit();`;

/** What the page posts and to whom. */
export interface AutoPost {
  /** The tool's redirect URI, to which the page posts the form. */
  readonly redirectUri: string;
  /** The signed `id_token`. */
  readonly idToken: string;
  /** The `state` of the tool's authentication request, returned unchanged. */
  readonly state: string;
  /** The origin of the page that frames this one, the only one that may. */
  readonly frameOrigin: string;
}

/**
 * Builds the page that posts the `id_token` to the tool (Security Framework section 5.1.1.3, `response_mode=form_post`). The page
 * has a policy that allows its one script by hash, forms only to the origin of the redirect URI and framing only by the
 * the host's frame page, because the tool's frame is same-origin with the platform's pages on the platform's origin; every
 * value in it is HTML-encoded; and the answer is not cached and sends no referrer.
 */
export function autoPostPage(post: AutoPost): Promise<HttpResponse> {
  const { redirectUri, idToken, state, frameOrigin } = post;
  const body = `<form id="form" method="post" action="${escapeHtml(redirectUri)}">
<input type="hidden" name="id_token" value="${escapeHtml(idToken)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<noscript><button type="submit">Continue</button></noscript>
</form>
`;
  return renderPage({ body, script: SCRIPT, formAction: new URL(redirectUri).origin, frameAncestors: frameOrigin });
}
