import { checkNonEmptyString, checkRecord } from "@interopkit/core/checks";
import { scriptSource } from "../protocol/internal.js";

/** The name of the frame that shows the storage page, when the host names none. */
export const DEFAULT_STORAGE_TARGET = "lti-storage";

/** The options of `buildCapabilitiesScript`. */
export interface CapabilitiesScriptOptions {
  /**
   * The name of the frame that shows the storage page, which the answer names for `lti.put_data` and `lti.get_data`.
   *
   * @defaultValue `"lti-storage"`
   */
  readonly storageTarget?: string;
}

/** The script that the host's frame page runs, and what its content security policy names it by. */
export interface CapabilitiesScript {
  /** The text of the script, to put between the tags of an inline `script` element as it is. */
  readonly source: string;
  /** The source expression that names the script in `script-src`, such as `'sha256-…'`. */
  readonly hash: string;
}

// The page answers at once, as Client Side postMessages 0.1 section 4.1 asks: a tool waits only a short time, 100 ms for the
// tool role of this package, before it takes the request as unsupported. The answer goes to the window that asked and to its
// origin, and a window of an opaque origin, to which no answer can be addressed, gets none.
const SCRIPT = `(function () {
  "use strict";
  var target = __TARGET__;
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (typeof data !== "object" || data === null || data.subject !== "lti.capabilities") return;
    if (typeof data.message_id !== "string" || event.source === null || event.origin === "null") return;
    event.source.postMessage(
      {
        subject: "lti.capabilities.response",
        message_id: data.message_id,
        supported_messages: [
          { subject: "lti.capabilities" },
          { subject: "lti.put_data", frame: target },
          { subject: "lti.get_data", frame: target },
        ],
      },
      event.origin,
    );
  });
})();`;

/**
 * Builds the inline script that answers `lti.capabilities` on the host's frame page (LTI Client Side postMessages 0.1 section
 * 4.1), naming the frame of the storage page for `lti.put_data` and `lti.get_data`, with the source expression that the page's
 * content security policy names it by.
 *
 * @remarks
 * The tool's pages of the client-side login ask the window that frames them for its capabilities before they store or fetch
 * their `state` and `nonce`. The frame page of the host shows the tool's frame and the storage page's frame, and only it can
 * answer for both. The script answers any window that asks, at the origin that asked: the answer holds nothing but the name of
 * a frame.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-cs-pm/v0p1 | LTI Client Side postMessages 0.1}
 * @param options - The name of the frame of the storage page.
 * @returns The script and its hash.
 * @throws `DataError` when the options are not an object, or `storageTarget` is not a non-empty string.
 */
export async function buildCapabilitiesScript(options: CapabilitiesScriptOptions = {}): Promise<CapabilitiesScript> {
  checkRecord(options, "The options must be an object");
  const { storageTarget = DEFAULT_STORAGE_TARGET } = options;
  checkNonEmptyString(storageTarget, "The option storageTarget");
  // JSON is a JavaScript literal; `<` is escaped so that no text of the name can close the script element.
  const literal = JSON.stringify(storageTarget).replaceAll("<", "\\u003c");
  const source = SCRIPT.replace("__TARGET__", () => literal);
  return { source, hash: await scriptSource(source) };
}
