import type { HttpResponse } from "@interopkit/core/http";
import { escapeHtml, renderPage } from "../protocol/internal.js";

// How long a page waits for the platform to answer a storage message before it tells the user. A storage message is a
// local call between two frames of one browser, so a few seconds mean that the platform does not answer.
const STORAGE_TIMEOUT_MS = 10_000;
// LTI Client Side postMessages 0.1 section 4.1.1: a platform that supports the capabilities request answers it at once, and a
// tool waits "a few milliseconds" before it takes the request as unsupported. A loaded browser takes longer than a few.
const CAPABILITIES_TIMEOUT_MS = 100;

/** The form parameter in which the verification page returns the `state` that it fetched from the platform's storage. */
export const STORED_STATE = "stored_state";
/** The form parameter in which the verification page returns the `nonce` that it fetched from the platform's storage. */
export const STORED_NONCE = "stored_nonce";

// The pages are small and static, so that the CSP names the hash of each script; the values go in a data attribute, which
// the script parses. The messages follow LTI Client Side OIDC 0.1 sections 3.1 to 3.4: `lti.put_data` and `lti.get_data`, a
// response `<subject>.response` with the same `message_id`, from the origin of the platform's authentication endpoint.
//
// Before them a page asks the window that framed or opened it for its capabilities (Client Side postMessages 0.1 section
// 4.1), with the wildcard origin that section 4.1.2 asks for, since the request holds nothing but its id. A frame that the
// answer names for the subject receives the storage messages; without an answer, or without a frame for the subject, the
// `lti_storage_target` of the login does. Whichever frame it is, a storage message goes only to the platform's origin. A page
// with neither a parent nor an opener has no window to ask, and `done` learns it from its second argument.
const FIND_TARGET = `function findTarget(config, done) {
    var base = null;
    try {
      base = window.parent !== window ? window.parent : window.opener;
    } catch (error) {
      base = null;
    }
    if (!base) {
      done(null, false);
      return;
    }
    var id = window.crypto.randomUUID();
    var finished = false;
    var wait;
    function finish(name) {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", listen);
      window.clearTimeout(wait);
      var target = null;
      try {
        target = name === "_parent" ? base : base.frames[name];
      } catch (error) {
        target = null;
      }
      done(target || null, true);
    }
    function listen(event) {
      var data = event.data;
      if (event.source !== base || typeof data !== "object" || data === null) return;
      if (data.subject !== "lti.capabilities.response" || data.message_id !== id) return;
      var named = (Array.isArray(data.supported_messages) ? data.supported_messages : []).filter(function (each) {
        return each !== null && typeof each === "object" && each.subject === config.subject && typeof each.frame === "string" && each.frame !== "";
      });
      finish(named.length > 0 ? named[0].frame : config.frame);
    }
    window.addEventListener("message", listen);
    wait = window.setTimeout(function () {
      finish(config.frame);
    }, config.capabilitiesTimeoutMs);
    base.postMessage({ subject: "lti.capabilities", message_id: id }, "*");
  }`;

const PUT_SCRIPT = `(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("lti").dataset.config);
  var failure = document.getElementById("failure");
  var pending = new Set();
  var timer = window.setTimeout(fail, config.timeoutMs);
  function fail() {
    window.clearTimeout(timer);
    failure.hidden = false;
  }
  ${FIND_TARGET}
  findTarget(config, function (target, framed) {
    // A window of its own, such as a tab opened with noopener, keeps the first-party cookie of the login, which binds the launch.
    if (!framed) {
      window.clearTimeout(timer);
      window.location.replace(config.authenticationRequest);
      return;
    }
    if (!target) {
      fail();
      return;
    }
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (event.origin !== config.origin || typeof data !== "object" || data === null) return;
      if (data.subject !== "lti.put_data.response" || !pending.has(data.message_id)) return;
      if (data.error) {
        fail();
        return;
      }
      pending.delete(data.message_id);
      if (pending.size === 0) {
        window.clearTimeout(timer);
        window.location.replace(config.authenticationRequest);
      }
    });
    [["state_" + config.state, config.state], ["nonce_" + config.nonce, config.nonce]].forEach(function (entry) {
      var id = window.crypto.randomUUID();
      pending.add(id);
      target.postMessage({ subject: "lti.put_data", message_id: id, key: entry[0], value: entry[1] }, config.origin);
    });
  });
})();`;

const GET_SCRIPT = `(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("lti").dataset.config);
  var failure = document.getElementById("failure");
  var form = document.getElementById("form");
  var pending = new Map();
  var timer = window.setTimeout(fail, config.timeoutMs);
  function fail() {
    window.clearTimeout(timer);
    failure.hidden = false;
  }
  ${FIND_TARGET}
  findTarget(config, function (target) {
    if (!target) {
      fail();
      return;
    }
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (event.origin !== config.origin || typeof data !== "object" || data === null) return;
      if (data.subject !== "lti.get_data.response" || !pending.has(data.message_id)) return;
      if (data.error || typeof data.value !== "string") {
        fail();
        return;
      }
      form.elements.namedItem(pending.get(data.message_id)).value = data.value;
      pending.delete(data.message_id);
      if (pending.size === 0) {
        window.clearTimeout(timer);
        form.requestSubmit();
      }
    });
    [["state_" + config.state, config.stateField], ["nonce_" + config.nonce, config.nonceField]].forEach(function (entry) {
      var id = window.crypto.randomUUID();
      pending.set(id, entry[1]);
      target.postMessage({ subject: "lti.get_data", message_id: id, key: entry[0] }, config.origin);
    });
  });
})();`;

const FAILURE =
  "The launch could not continue: the platform did not store or return the launch state. Close this window and start the launch again.";

/**
 * Builds a page with one script, for the browser to run in the frame of the platform.
 *
 * @param referrerPolicy - `same-origin` for the verification page, whose post `handleLaunch` accepts only with the `Origin` of the
 * tool, which a browser sends as `null` under `no-referrer`.
 */
function respond(
  script: string,
  config: object,
  body: string,
  referrerPolicy: "no-referrer" | "same-origin",
): Promise<HttpResponse> {
  const timeouts = { timeoutMs: STORAGE_TIMEOUT_MS, capabilitiesTimeoutMs: CAPABILITIES_TIMEOUT_MS };
  const page = `<div id="lti" data-config="${escapeHtml(JSON.stringify({ ...config, ...timeouts }))}"></div>
${body}<p id="failure" role="alert" hidden>${FAILURE}</p>
`;
  return renderPage({ body: page, script, formAction: "'self'", referrerPolicy });
}

/** The values of a login that the page stores in the platform. */
export interface StoragePut {
  /**
   * The `lti_storage_target` of the initiation: the name of the platform's frame, or `_parent`. A frame that the platform
   * names in its answer to `lti.capabilities` takes its place.
   */
  readonly frame: string;
  /** The `state` of the authentication request. */
  readonly state: string;
  /** The `nonce` of the authentication request. */
  readonly nonce: string;
  /** The authentication request: the URL to which the page redirects the browser once the platform has stored the values. */
  readonly authenticationRequest: string;
}

/**
 * Builds the page that asks the platform for its capabilities, stores `state` and `nonce` in the platform with
 * `lti.put_data` and then redirects the browser to the authentication request (LTI Client Side OIDC 0.1 sections 2.3 and
 * 2.5, Client Side postMessages 0.1 section 4.1).
 */
export function putDataPage(put: StoragePut): Promise<HttpResponse> {
  const { frame, state, nonce, authenticationRequest } = put;
  const origin = new URL(authenticationRequest).origin;
  return respond(
    PUT_SCRIPT,
    { subject: "lti.put_data", frame, state, nonce, origin, authenticationRequest },
    "",
    "no-referrer",
  );
}

/** What the verification page needs to fetch the values and return them with the token. */
export interface StorageGet {
  /** The `lti_storage_target` of the initiation. */
  readonly frame: string;
  /** The `state` of the launch. */
  readonly state: string;
  /** The `nonce` of the login. */
  readonly nonce: string;
  /** The authentication endpoint of the platform, whose origin the storage answers from. */
  readonly authenticationUrl: string;
  /** The launch URL of the tool, to which the page posts the form. */
  readonly redirectUri: string;
  /** The `id_token` that the platform posted, which the form returns unchanged. */
  readonly idToken: string;
}

/**
 * Builds the verification page: it asks the platform for its capabilities, fetches `state` and `nonce` from the platform's
 * storage with `lti.get_data` and submits them with the token to the launch URL (LTI Client Side OIDC 0.1 section 2.7,
 * Client Side postMessages 0.1 section 4.1). Its referrer policy is `same-origin`, so that the post carries the `Origin` of the
 * tool, which `handleLaunch` checks.
 */
export function getDataPage(get: StorageGet): Promise<HttpResponse> {
  const { frame, state, nonce, authenticationUrl, redirectUri, idToken } = get;
  const field = (name: string, value: string): string =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">\n`;
  const form = `<form id="form" method="post" action="${escapeHtml(redirectUri)}">
${field("id_token", idToken)}${field("state", state)}${field(STORED_STATE, "")}${field(STORED_NONCE, "")}</form>
`;
  const config = {
    subject: "lti.get_data",
    frame,
    state,
    nonce,
    origin: new URL(authenticationUrl).origin,
    stateField: STORED_STATE,
    nonceField: STORED_NONCE,
  };
  return respond(GET_SCRIPT, config, form, "same-origin");
}
