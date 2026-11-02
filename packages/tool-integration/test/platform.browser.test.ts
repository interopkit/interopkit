// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.

import { signerFromCryptoKey } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createJwksCache } from "../src/index.js";
import {
  buildCapabilitiesScript,
  buildPlatformEndpoints,
  handlePlatformRequest,
  type LaunchStore,
  ltiPlatformLogin,
  type MessageInput,
  type PlatformConfig,
  type PlatformLoginOptions,
  type PlatformRequestOptions,
  type ToolRegistration,
} from "../src/platform/index.js";
import { hostileOrigin as hostile, requestsTo, seenBy } from "./hostile.js";
import { textOf } from "./text-of.js";
import { waitFor } from "./wait.js";

/**
 * The page that posts the id_token runs in the engines of the browsers. The tool's origin is a fixture server, which the
 * page reaches under its own policy, and which records the path that the form posts to.
 */

const { other, stranger } = inject("fixtures");
const TOOL = "https://tool.example.com";
const message: MessageInput = {
  messageType: "LtiResourceLinkRequest",
  clientId: "tool-client-1",
  deploymentId: "deployment-1",
  targetLinkUri: `${TOOL}/lti/tools/drawing`,
  user: { subject: "candidate-7" },
  roles: [],
  resourceLink: { id: "q1" },
};
const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const config: PlatformConfig = {
  issuer: "https://platform.example",
  origin: "https://lti.platform.example",
  frameOrigin: "https://app.platform.example",
  reservedOrigins: ["https://assets.platform.example"],
  keys: {
    signer: signerFromCryptoKey(pair.privateKey, { algorithm: "ES256", keyId: "platform-1" }),
    publicKeys: [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "platform-1" } as JsonWebKey],
  },
  hintKey: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
};
const clock = { now: () => 1_700_000_000_000 };
const kept = new Map<string, MessageInput>();
const launches: LaunchStore = {
  put: async (id, value) => void kept.set(id, value),
  take: async (id) => {
    const value = kept.get(id);
    kept.delete(id);
    return value;
  },
};

/** The platform with a tool whose redirect URI has a path of the test's own. */
function platform(path: string): { login: PlatformLoginOptions; requests: PlatformRequestOptions } {
  const tool: ToolRegistration = {
    clientId: "tool-client-1",
    deploymentIds: ["deployment-1"],
    loginUrl: `${TOOL}/lti/login`,
    redirectUris: [`${TOOL}${path}`],
    jwksUrl: `${TOOL}/jwks`,
    scopes: [],
  };
  const login: PlatformLoginOptions = {
    config,
    clock,
    registration: async () => tool,
    check: async () => undefined,
    launches,
  };
  const requests: PlatformRequestOptions = {
    config,
    clock,
    client: async () => tool,
    launches,
    once: async () => true,
    jwks: createJwksCache({ fetch: () => Promise.reject(new Error("No key set is fetched.")), clock }),
  };
  return { login, requests };
}

/** Makes the platform answer the authentication request of a launch with the given `state`. */
async function answer(path: string, state: string): Promise<HttpResponse> {
  const { login, requests } = platform(path);
  const initiation = new URL(await ltiPlatformLogin(message, login));
  const parameters = new URLSearchParams([
    ["scope", "openid"],
    ["response_type", "id_token"],
    ["client_id", "tool-client-1"],
    ["redirect_uri", `${TOOL}${path}`],
    ["login_hint", initiation.searchParams.get("login_hint") ?? ""],
    ["state", state],
    ["response_mode", "form_post"],
    ["nonce", "nonce-1"],
    ["prompt", "none"],
    ["lti_message_hint", initiation.searchParams.get("lti_message_hint") ?? ""],
  ]);
  const url = `${buildPlatformEndpoints(config).authorization}?${parameters}`;
  return handlePlatformRequest({ method: "GET", url, headers: {}, body: new Uint8Array() }, requests);
}

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

/**
 * Loads the page in a frame under its policy, as a meta element (a header does not reach `srcdoc`; framing is the header's
 * and the host's). The tool's origin is the fixture server's, so that the form posts to a server that records it.
 */
function load(page: HttpResponse): HTMLIFrameElement {
  const policy = (page.headers["content-security-policy"] ?? "")
    .replace(/; frame-ancestors [^;]*/u, "")
    .replaceAll(TOOL, other);
  const frame = document.createElement("iframe");
  frame.srcdoc = textOf(page.body)
    .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replaceAll(TOOL, other);
  frames.push(frame);
  document.body.append(frame);
  return frame;
}

describe("the page that posts the id_token", () => {
  it("posts the form to the redirect URI of the tool by itself, under its policy", async () => {
    const path = `/launch/${crypto.randomUUID()}`;
    load(await answer(path, "state-1"));
    await waitFor(async () => expect(await requestsTo(other)).toContain(path));
  });

  it("writes a hostile state as text in the markup, whatever the engine's parser", async () => {
    const hostile = `"><img src="${stranger}/leak" onerror="alert(1)"><script>alert(2)</script><form action="${stranger}/x">`;
    const path = `/launch/${crypto.randomUUID()}`;
    const page = await answer(path, hostile);
    const document2 = new DOMParser().parseFromString(textOf(page.body), "text/html");
    expect(document2.querySelectorAll("form")).toHaveLength(1);
    expect(document2.querySelectorAll("script")).toHaveLength(1);
    expect(document2.querySelectorAll("img")).toHaveLength(0);
    expect(document2.querySelector<HTMLInputElement>("input[name=state]")?.value).toBe(hostile);
    expect(document2.querySelector("form")?.getAttribute("action")).toBe(`${TOOL}${path}`);
    load(page);
    await waitFor(async () => expect(await requestsTo(other)).toContain(path));
    expect(await requestsTo(stranger)).toEqual([]);
  });

  it("writes a redirect URI with a query as text in the markup", async () => {
    const path = `/launch/${crypto.randomUUID()}?a=1&b="2"`;
    const page = await answer(path, "state-2");
    const document2 = new DOMParser().parseFromString(textOf(page.body), "text/html");
    expect(document2.querySelector("form")?.getAttribute("action")).toBe(`${TOOL}${path}`);
  });
});

/** Opens a frame with a name and a document. */
function open(name: string, html: string): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.name = name;
  frame.srcdoc = html;
  frames.push(frame);
  return new Promise((done) => {
    frame.addEventListener("load", () => done(frame), { once: true });
    document.body.append(frame);
  });
}

describe("the storage page", () => {
  const TOOL_RELAY = `<script>
window.addEventListener("message", function (event) {
  if (event.source === window.parent) window.parent.frames["lti-storage"].postMessage(event.data, "*");
  else window.parent.postMessage({ reply: event.data }, "*");
});
</script>`;

  /** The storage page beside a tool frame that relays what the test says to it, and what it answers. */
  async function pages(): Promise<{ ask(message: Record<string, unknown>): Promise<Record<string, unknown>> }> {
    const { requests } = platform("/launch");
    const storageUrl = buildPlatformEndpoints(config).storage;
    const page = await handlePlatformRequest(
      { method: "GET", url: storageUrl, headers: {}, body: new Uint8Array() },
      requests,
    );
    const policy = (page.headers["content-security-policy"] ?? "").replace(/; frame-ancestors [^;]*/u, "");
    await open(
      "lti-storage",
      textOf(page.body).replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`),
    );
    const tool = await open("lti-tool", TOOL_RELAY);
    let next = 0;
    return {
      ask(message) {
        next += 1;
        const request = { ...message, message_id: `m-${next}` };
        return new Promise((done) => {
          const listen = (event: MessageEvent): void => {
            if (event.data?.reply?.message_id !== request.message_id) return;
            window.removeEventListener("message", listen);
            done(event.data.reply);
          };
          window.addEventListener("message", listen);
          tool.contentWindow?.postMessage(request, "*");
        });
      },
    };
  }

  it("keeps a value for the tool and gives it back, answering with the message_id of the request", async () => {
    const { ask } = await pages();
    expect(await ask({ subject: "lti.put_data", key: "state_1", value: "abc" })).toMatchObject({
      subject: "lti.put_data.response",
      message_id: "m-1",
      key: "state_1",
      value: "abc",
    });
    expect(await ask({ subject: "lti.get_data", key: "state_1" })).toMatchObject({
      subject: "lti.get_data.response",
      value: "abc",
    });
  });

  it("refuses a key that was never stored, an empty key, and a subject it does not know", async () => {
    const { ask } = await pages();
    expect(await ask({ subject: "lti.get_data", key: "none" })).toMatchObject({ error: { code: "key_not_found" } });
    expect(await ask({ subject: "lti.get_data", key: "" })).toMatchObject({ error: { code: "bad_request" } });
    expect(await ask({ subject: "lti.other", key: "k" })).toMatchObject({ error: { code: "unsupported_subject" } });
  });

  it("answers storage_exhaustion beyond 4,096 bytes and beyond 500 keys, the least that a platform offers", async () => {
    const { ask } = await pages();
    expect(await ask({ subject: "lti.put_data", key: "big", value: "x".repeat(4_097) })).toMatchObject({
      error: { code: "storage_exhaustion" },
    });
    for (let index = 0; index < 500; index += 1) {
      expect(await ask({ subject: "lti.put_data", key: `k${index}`, value: "v" })).toMatchObject({ value: "v" });
    }
    expect(await ask({ subject: "lti.put_data", key: "k500", value: "v" })).toMatchObject({
      error: { code: "storage_exhaustion" },
    });
  });

  it("keeps the values by the origin of the message: a frame of another origin does not read what the tool stored", async () => {
    const { ask } = await pages();
    await ask({ subject: "lti.put_data", key: "state_1", value: "secret" });
    // The frame of the tool is replaced by one of the hostile origin that has its name, which the page then answers.
    document.querySelector("iframe[name=lti-tool]")?.remove();
    const storage = document.querySelector<HTMLIFrameElement>("iframe[name=lti-storage]");
    const index = Array.from(document.querySelectorAll("iframe")).indexOf(storage as HTMLIFrameElement);
    const id = crypto.randomUUID();
    const request = [{ subject: "lti.get_data", message_id: "m-x", key: "state_1" }];
    const intruder = document.createElement("iframe");
    intruder.name = "lti-tool";
    intruder.src = `${hostile}/probe?id=${id}&to=${index}&send=${encodeURIComponent(JSON.stringify(request))}`;
    frames.push(intruder);
    document.body.append(intruder);
    await waitFor(async () => expect(await seenBy(id)).toHaveLength(1));
    const [answer] = await seenBy(id);
    expect(answer?.data).toMatchObject({ subject: "lti.get_data.response", error: { code: "key_not_found" } });
    expect(JSON.stringify(answer)).not.toContain("secret");
  });

  it("answers to the origin that sent the request: a tool frame that moved to another site before the answer does not get it", async () => {
    const { ask } = await pages();
    await ask({ subject: "lti.put_data", key: "state_1", value: "secret" });
    const storage = document.querySelector<HTMLIFrameElement>("iframe[name=lti-storage]")?.contentWindow;
    const tool = document.querySelector<HTMLIFrameElement>("iframe[name=lti-tool]");
    const id = crypto.randomUUID();
    // The frame of the tool goes to another site, as it may while its request waits: the window stays, and its document is
    // the hostile one.
    tool?.removeAttribute("srcdoc");
    tool?.setAttribute("src", `${hostile}/probe?id=${id}`);
    await waitFor(async () => expect(await requestsTo(hostile)).toContain(`/ready?id=${id}`));
    // The page then handles a request that the tool's own document sent before it left: from the origin of the test page, and
    // from the window of the frame. The two properties are set on the event, because Firefox does not take a window of another
    // origin as the `source` of a constructed event.
    const request = (origin: string, messageId: string, key: string): MessageEvent => {
      const data = { subject: "lti.get_data", message_id: messageId, key };
      const event = new MessageEvent("message", { data });
      Object.defineProperty(event, "origin", { value: origin });
      Object.defineProperty(event, "source", { value: tool?.contentWindow });
      return event;
    };
    storage?.dispatchEvent(request(location.origin, "late", "state_1"));
    // A request from the hostile origin itself is answered to it. The messages arrive in order, so once this one has, the
    // answer to the late request has had its turn too, and the probe has seen it if it was sent.
    storage?.dispatchEvent(request(hostile, "control", "none"));
    await waitFor(async () => expect(await seenBy(id)).not.toHaveLength(0));
    const seen = await seenBy(id);
    expect(seen.map(({ data }) => data.message_id)).toStrictEqual(["control"]);
    expect(JSON.stringify(seen)).not.toContain("secret");
  });

  it("answers only the frame of the tool: a request from the page that frames it gets no answer", async () => {
    const { ask } = await pages();
    const answers: unknown[] = [];
    const listen = (event: MessageEvent): void => {
      if (event.data?.subject === "lti.put_data.response") answers.push(event.data);
    };
    window.addEventListener("message", listen);
    const storage = document.querySelector<HTMLIFrameElement>("iframe[name=lti-storage]");
    storage?.contentWindow?.postMessage({ subject: "lti.put_data", message_id: "direct", key: "k", value: "v" }, "*");
    // The page handles messages in order, so an answer to this one would arrive before the answer to the tool's.
    await ask({ subject: "lti.get_data", key: "k" });
    window.removeEventListener("message", listen);
    expect(answers).toStrictEqual([]);
  });
});

describe("the script that answers the capabilities", () => {
  /** A tool frame inside a frame of the host page, which asks its parent for the capabilities and reports what it gets. */
  const TOOL_ASKS = `<script>
window.addEventListener("message", function (event) {
  if (event.data && event.data.subject === "lti.capabilities.response") {
    window.parent.parent.postMessage({ answer: event.data, sameSource: event.source === window.parent }, "*");
  }
});
window.parent.postMessage({ subject: "lti.capabilities", message_id: "c-1" }, "*");
</script>`;

  it("answers the tool's frame with the frame of the storage page for lti.put_data and lti.get_data", async () => {
    const { source } = await buildCapabilitiesScript({ storageTarget: "storage-7" });
    const answers: Record<string, unknown>[] = [];
    const listen = (event: MessageEvent): void => {
      if (event.data?.answer !== undefined) answers.push(event.data);
    };
    window.addEventListener("message", listen);
    const escaped = TOOL_ASKS.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    await open("host", `<script>${source}</script><iframe name="lti-tool" srcdoc="${escaped}"></iframe>`);
    await waitFor(() => expect(answers).toHaveLength(1));
    window.removeEventListener("message", listen);
    const [received] = answers;
    expect(received).toMatchObject({
      sameSource: true,
      answer: {
        subject: "lti.capabilities.response",
        message_id: "c-1",
        supported_messages: [
          { subject: "lti.capabilities" },
          { subject: "lti.put_data", frame: "storage-7" },
          { subject: "lti.get_data", frame: "storage-7" },
        ],
      },
    });
  });
});
