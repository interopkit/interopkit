// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.
import { checkNonEmptyString } from "@interopkit/core/checks";
import type { HttpResponse } from "@interopkit/core/http";
import { escapeHtml, pagePolicy } from "../protocol/internal.js";
import { checkPlatformOptions, type PlatformStorageOptions } from "./options.js";

/** The name of the frame of the tool, when the host names none. */
const DEFAULT_TOOL_FRAME = "lti-tool";

/**
 * The most bytes, as the sum of the lengths of the keys and values, that the page keeps for one origin. It is the least that
 * a platform must offer.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-pm-s/v0p1 | LTI postMessage Storage 0.1}
 */
const STORAGE_MAX_BYTES = 4096;

/**
 * The most keys that the page keeps for one origin. It is the least that a platform must offer.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-pm-s/v0p1 | LTI postMessage Storage 0.1}
 */
const STORAGE_MAX_KEYS = 500;

// The page runs in a frame of the platform's origin, beside the frame of the tool. The tool posts to it with the origin of
// the authentication endpoint as the target, which the host's own origin could not receive, and checks that the answer
// comes from that origin. The page answers only the window of the tool's frame, keeps the values by the origin of the
// message, and replies to the window and the origin that sent the request. The origin is the target of the reply, and not `*`:
// a tool frame that has moved to another site while its request waited gets nothing. A message from an opaque origin is
// refused first, though `postMessage` to the target `"null"` throws, so that the refusal does not rest on that throw alone.
const SCRIPT = `(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("lti").dataset.config);
  var stores = new Map();
  function tool() {
    try {
      return window.parent.frames[config.tool] || null;
    } catch (error) {
      return null;
    }
  }
  function answer(event, data, body) {
    var reply = { subject: data.subject + ".response", message_id: data.message_id };
    Object.keys(body).forEach(function (name) {
      reply[name] = body[name];
    });
    event.source.postMessage(reply, event.origin);
  }
  function refuse(event, data, code, message) {
    answer(event, data, { error: { code: code, message: message } });
  }
  function owner(event) {
    return event.origin;
  }
  function size(store) {
    var total = 0;
    store.forEach(function (value, key) {
      total += key.length + value.length;
    });
    return total;
  }
  function put(event, data) {
    var store = stores.get(owner(event)) || new Map();
    var value = data.value === undefined || data.value === null ? "" : data.value;
    if (typeof value !== "string") return refuse(event, data, "bad_request", "The value must be a string.");
    if (value === "") {
      store.delete(data.key);
      return answer(event, data, { key: data.key });
    }
    var kept = store.get(data.key);
    var bytes = size(store) - (kept === undefined ? 0 : data.key.length + kept.length) + data.key.length + value.length;
    if ((kept === undefined && store.size >= config.maxKeys) || bytes > config.maxBytes) {
      return refuse(event, data, "storage_exhaustion", "The storage for this origin is full.");
    }
    store.set(data.key, value);
    stores.set(owner(event), store);
    return answer(event, data, { key: data.key, value: value });
  }
  function get(event, data) {
    var value = (stores.get(owner(event)) || new Map()).get(data.key);
    if (value === undefined) return refuse(event, data, "key_not_found", "There is no value stored for this key.");
    return answer(event, data, { key: data.key, value: value });
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (typeof data !== "object" || data === null || typeof data.subject !== "string") return;
    if (event.origin === "null" || event.source === null || event.source !== tool()) return;
    if (data.subject !== "lti.put_data" && data.subject !== "lti.get_data") {
      return refuse(event, data, "unsupported_subject", "The storage answers lti.put_data and lti.get_data.");
    }
    if (typeof data.message_id !== "string" || typeof data.key !== "string" || data.key === "") {
      return refuse(event, data, "bad_request", "The request needs a message_id and a key.");
    }
    return data.subject === "lti.put_data" ? put(event, data) : get(event, data);
  });
})();`;

/**
 * Builds the page that stores the values of a tool for the length of its frame: `lti.put_data` and `lti.get_data`, kept by
 * the origin of the message and answered to the window that sent them, and only to the frame of the tool. The page has a policy
 * that allows its one script by hash and framing only by the host's frame page; the answer is not cached and sends no referrer.
 *
 * @param frameOrigin - The origin of the page that frames this one, the only one that may.
 * @param toolFrame - The name of the frame of the tool, the only one that the page answers.
 */
async function storagePage(frameOrigin: string, toolFrame: string): Promise<HttpResponse> {
  const config = { tool: toolFrame, maxBytes: STORAGE_MAX_BYTES, maxKeys: STORAGE_MAX_KEYS };
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LTI storage</title>
</head>
<body>
<div id="lti" data-config="${escapeHtml(JSON.stringify(config))}"></div>
<script>${SCRIPT}</script>
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
      "content-security-policy": await pagePolicy(SCRIPT, "'none'", frameOrigin),
    },
    body: html,
  };
}

/**
 * Answers a request for the storage page of the platform: the page that keeps the `state` and the `nonce` of a tool's login
 * (LTI Client Side OIDC 0.1) and that the `lti_storage_target` of `ltiPlatformLogin` names. The host shows it in a hidden
 * frame beside the frame of the tool.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-cs-oidc/v0p1 | LTI Client Side OIDC 0.1}
 * @param options - The platform, and the name of the frame of the tool.
 * @returns The page.
 * @throws `DataError` when the options are not those of a platform.
 */
export function platformStorage(options: PlatformStorageOptions): Promise<HttpResponse> {
  checkPlatformOptions(options);
  const { toolFrame = DEFAULT_TOOL_FRAME } = options;
  checkNonEmptyString(toolFrame, "The option toolFrame");
  return storagePage(options.config.frameOrigin, toolFrame);
}
