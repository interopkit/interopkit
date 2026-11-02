import type { HttpResponse } from "@interopkit/core/http";
import { renderPage } from "../../protocol/internal.js";

// Dynamic Registration 1.0 section 3.7: the window that the platform opened, a frame or a new tab, tells its opener or its parent
// that it may be closed. The message carries nothing else, so it goes to any origin, as the specification's example sends it.
const CLOSE_SCRIPT = `(window.opener || window.parent).postMessage({ subject: "org.imsglobal.lti.close" }, "*");`;

/**
 * Returns the page that ends a registration (Dynamic Registration 1.0 section 3.7): its one script posts the message
 * `org.imsglobal.lti.close` to the window that opened it or the frame that holds it, so that the platform closes it and shows its
 * administrator the tool to review. The tool sends it once the registration is done, whether it succeeded or not.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-dr/v1p0 | LTI Dynamic Registration 1.0}
 * @returns The page, under a policy that allows its script by hash and no form.
 */
export function createRegistrationClosePage(): Promise<HttpResponse> {
  return renderPage({ body: "", script: CLOSE_SCRIPT, formAction: "'none'" });
}
