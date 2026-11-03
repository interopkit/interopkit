// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.

import { signerFromCryptoKey } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createJwksCache } from "../src/index.js";
import {
  type LoginRecord,
  type LtiLaunchOptions,
  type LtiStore,
  ltiLaunch,
  ltiLogin,
  type PlatformRegistration,
} from "../src/tool/index.js";
import { hostileOrigin, requestsTo, seenBy } from "./hostile.js";
import { textOf } from "./text-of.js";
import { waitFor } from "./wait.js";

/**
 * The pages of the client-side storage path run in the engines of the browsers. The test page plays the platform: it
 * keeps the storage of LTI Client Side OIDC 0.1 section 4.1 for the origin of the tool, and the tool's page runs in a frame of it.
 */

const origin = location.origin;
const { other } = inject("fixtures");
const PLATFORM = "https://lms.example.edu";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  false,
  ["sign"],
);
const registration: PlatformRegistration = {
  issuer: PLATFORM,
  clientId: "client-1",
  deploymentIds: ["deployment-1"],
  authenticationUrl: `${PLATFORM}/auth`,
  jwksUrl: "https://lms.example.edu/jwks",
  accessTokenUrl: "https://lms.example.edu/token",
  redirectUri: "https://tool.example.com/lti/launch",
  signer: signerFromCryptoKey(pair.privateKey, { algorithm: "RS256", keyId: "tool-1" }),
};
const clock = { now: () => 1_700_000_000_000 };

/** A store in memory. */
function memoryStore(): LtiStore & { readonly records: Map<string, LoginRecord> } {
  const records = new Map<string, LoginRecord>();
  return {
    records,
    put: async (state, record) => {
      records.set(state, record);
    },
    get: async (state) => records.get(state),
    delete: async (state) => records.delete(state),
  };
}

/** The tool: its registration, a store, and a cache whose key set is never fetched. */
function tool(): { options: LtiLaunchOptions; store: ReturnType<typeof memoryStore> } {
  const store = memoryStore();
  const jwks = createJwksCache({ fetch: () => Promise.reject(new Error("The pages do not fetch.")), clock });
  return { store, options: { registration: async () => registration, clock, store, jwks } };
}

const storages: PlatformStorage[] = [];

/** The platform's side of the storage: answers `lti.put_data` and `lti.get_data` as LTI Client Side OIDC 0.1 section 4.1 does. */
class PlatformStorage {
  readonly buckets = new Map<string, Map<string, string>>();
  private readonly held: (() => void)[] = [];
  private holding = true;
  private readonly fail: boolean;
  private readonly noise: boolean;
  private readonly badValue: boolean;
  /** The requests that the pages made, in order. */
  readonly requests: { readonly subject: string; readonly message_id: string; readonly key: string }[] = [];

  private readonly stop: () => void;

  constructor(listener: Window, options: { fail?: boolean; noise?: boolean; badValue?: boolean } = {}) {
    this.fail = options.fail ?? false;
    this.noise = options.noise ?? false;
    this.badValue = options.badValue ?? false;
    const handle = (event: MessageEvent): void => this.handle(event);
    listener.addEventListener("message", handle);
    this.stop = () => listener.removeEventListener("message", handle);
    storages.push(this);
  }

  /** Stops answering. */
  dispose(): void {
    this.stop();
  }

  /** Returns what the platform stores for the tool under a key. */
  get(key: string): string | undefined {
    return this.buckets.get(origin)?.get(key);
  }

  /** Stores a value for the tool, as the page of the login did. */
  put(key: string, value: string): void {
    this.buckets.set(origin, (this.buckets.get(origin) ?? new Map()).set(key, value));
  }

  /** Lets the answers go: they wait until the test has attached its listeners to the frame. */
  release(): void {
    this.holding = false;
    for (const answer of this.held.splice(0)) answer();
  }

  private handle(event: MessageEvent): void {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || !("subject" in data) || !("message_id" in data)) return;
    const { subject, message_id: messageId } = data;
    const key = "key" in data && typeof data.key === "string" ? data.key : "";
    if (subject !== "lti.put_data" && subject !== "lti.get_data") return;
    this.requests.push({ subject, message_id: String(messageId), key });
    if (subject === "lti.put_data" && "value" in data && typeof data.value === "string") this.put(key, data.value);
    const value = this.get(key);
    const response = this.fail
      ? { subject: `${subject}.response`, message_id: messageId, error: { code: "failed", message: "Refused." } }
      : subject === "lti.get_data" && value === undefined
        ? {
            subject: "lti.get_data.response",
            message_id: messageId,
            error: { code: "key_not_found", message: "There is no value stored for this key" },
          }
        : { subject: `${subject}.response`, message_id: messageId, key, value: this.badValue ? 5 : value };
    const target = { targetOrigin: event.origin };
    const reply = (): void => {
      if (this.noise) event.source?.postMessage({ subject: `${subject}.response`, message_id: "not-sent" }, target);
      event.source?.postMessage(response, target);
    };
    if (this.holding) this.held.push(reply);
    else reply();
  }
}

/**
 * The platform's answer to `lti.capabilities` (LTI Client Side postMessages 0.1 section 4.1): it lists the messages that it
 * supports, with the frame of each, and answers the window that asked.
 */
class Capabilities {
  /** The requests that reached the platform, with the origin of each. */
  readonly asked: { readonly subject: string; readonly origin: string }[] = [];
  private readonly stop: () => void;

  /**
   * @param supported - The supported messages of the answer.
   * @param messageId - Answers with this `message_id` in place of the request's, as a stray answer to another request does.
   */
  constructor(supported: readonly Readonly<Record<string, string>>[], messageId?: string) {
    const handle = (event: MessageEvent): void => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || !("subject" in data) || data.subject !== "lti.capabilities")
        return;
      this.asked.push({ subject: String(data.subject), origin: event.origin });
      const id = messageId ?? ("message_id" in data ? data.message_id : undefined);
      const answer = { subject: "lti.capabilities.response", message_id: id, supported_messages: supported };
      event.source?.postMessage(answer, { targetOrigin: event.origin });
    };
    window.addEventListener("message", handle);
    this.stop = () => window.removeEventListener("message", handle);
    responders.push(this);
  }

  /** Stops answering. */
  dispose(): void {
    this.stop();
  }
}

const responders: Capabilities[] = [];
const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const responder of responders.splice(0)) responder.dispose();
  for (const frame of frames.splice(0)) frame.remove();
  for (const storage of storages.splice(0)) storage.dispose();
});

// The page navigates to the authentication request. The test sends it to a document of its own, so that every engine
// loads it and lets the test read where the frame went; the query of the request becomes the fragment.
const AUTHENTICATION_DOCUMENT = URL.createObjectURL(new Blob(["<title>authentication</title>"], { type: "text/html" }));

/**
 * Loads a page of the tool in a frame, with its CSP as a meta element (a header does not reach `srcdoc`). The platform's
 * origin in the page is the origin of the test page, which is served over http: the page then talks to the test page.
 */
async function load(response: HttpResponse, name = ""): Promise<HTMLIFrameElement> {
  const policy = response.headers["content-security-policy"] ?? "";
  const frame = document.createElement("iframe");
  frame.name = name;
  const meta = `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  frame.srcdoc = textOf(response.body)
    .replace("<head>", meta)
    .replaceAll(`${PLATFORM}/auth?`, `${AUTHENTICATION_DOCUMENT}#`)
    .replaceAll(PLATFORM, origin);
  frames.push(frame);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  return frame;
}

/** The storage frame of a platform, a child of the test page with a name. */
async function storageFrame(name: string): Promise<Window> {
  const frame = document.createElement("iframe");
  frame.name = name;
  frame.srcdoc = "<!doctype html><title>storage</title>";
  frames.push(frame);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  if (!frame.contentWindow) throw new Error("The storage frame has no window.");
  return frame.contentWindow;
}

/** Opens a frame of the hostile origin: it posts the messages to the frame, if it is given, and records what it receives. */
async function probe(
  name: string,
  target?: HTMLIFrameElement,
  messages: readonly unknown[] = [],
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.name = name;
  const index = target === undefined ? -1 : Array.from(document.querySelectorAll("iframe")).indexOf(target);
  frame.src = `${hostileOrigin}/probe?id=${id}&to=${index}&send=${encodeURIComponent(JSON.stringify(messages))}`;
  frames.push(frame);
  document.body.append(frame);
  await waitFor(async () => expect(await requestsTo(hostileOrigin)).toContain(`/ready?id=${id}`));
  return { id };
}

/** A quiet time, in which a page that was going to act on a message it should have refused has done so. */
const quiet = (): Promise<void> => new Promise((done) => setTimeout(done, 300));

/** The answers that the platform would give to the requests of a page, with a value, from a frame that is not the platform. */
const spoofed = (storage: PlatformStorage, value: string): unknown[] =>
  storage.requests.map(({ subject, message_id: messageId, key }) => ({
    subject: `${subject}.response`,
    message_id: messageId,
    key,
    value,
  }));

/** Starts a login with a storage target and returns the page, with the `state` and `nonce` the tool made. */
async function login(
  storageTarget: string,
  ctx = tool(),
): Promise<{ page: HttpResponse; state: string; nonce: string; ctx: ReturnType<typeof tool> }> {
  const initiation = new URLSearchParams([
    ["iss", registration.issuer],
    ["login_hint", "24400320"],
    ["target_link_uri", "https://tool.example.com/lti/t"],
    ["lti_storage_target", storageTarget],
  ]);
  const page = await ltiLogin(
    { method: "GET", url: `https://tool.example.com/lti/login?${initiation}`, headers: {}, body: new Uint8Array() },
    ctx.options,
  );
  const [[state = "", record] = []] = [...ctx.store.records];
  return { page, state, nonce: record?.nonce ?? "", ctx };
}

describe("the page that stores state and nonce", () => {
  it("goes to the authentication request at once in a tab with neither a parent nor an opener, whose cookie binds the launch", async () => {
    // The tab is opened with noopener, as a platform may open a tool; the page runs with the headers of its answer, from a server.
    const { page, state } = await login("_parent");
    expect(page.headers["set-cookie"]).toContain(`=${state};`);
    const address = `${other}/page?id=${crypto.randomUUID()}`;
    const body = textOf(page.body).replaceAll(`${PLATFORM}/auth?`, `${other}/close?`).replaceAll(PLATFORM, origin);
    await fetch(address, { method: "POST", body: JSON.stringify({ headers: page.headers, body }) });
    expect(window.open(address, "_blank", "noopener")).toBeNull();
    await waitFor(async () =>
      expect(
        (await requestsTo(other)).some((path) => path.startsWith("/close?") && path.includes(`state=${state}`)),
      ).toBe(true),
    );
  });

  it("stores both in the platform's parent frame and then redirects to the authentication request", async () => {
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
    expect(storage.get(`state_${state}`)).toBe(state);
    expect(storage.get(`nonce_${nonce}`)).toBe(nonce);
    const request = new URLSearchParams(new URL(frame.contentWindow?.location.href ?? "").hash.slice(1));
    expect(request.get("state")).toBe(state);
    expect(request.get("nonce")).toBe(nonce);
    expect(request.get("response_mode")).toBe("form_post");
  });

  it("stores both in a frame of the platform that has the given name", async () => {
    const storage = new PlatformStorage(await storageFrame("lti-storage"));
    const { page, state, nonce } = await login("lti-storage");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
    expect(storage.get(`state_${state}`)).toBe(state);
    expect(storage.get(`nonce_${nonce}`)).toBe(nonce);
  });

  it("ignores an answer that is not to its message", async () => {
    const storage = new PlatformStorage(window, { noise: true });
    const { page } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
  });

  it("tells the user and stays when the platform answers with an error", async () => {
    const storage = new PlatformStorage(window, { fail: true });
    const { page } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
    expect(frame.contentWindow?.location.href).toBe("about:srcdoc");
  });

  it("tells the user, after the platform answers no capabilities, when it has no frame of the given name", async () => {
    const { page } = await login("no-such-frame");
    const frame = await load(page);
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
  });

  it("asks the window that framed it for its capabilities, and stores in the frame that the answer names", async () => {
    const storage = new PlatformStorage(await storageFrame("named-by-capabilities"));
    const capabilities = new Capabilities([
      { subject: "lti.capabilities" },
      { subject: "lti.put_data", frame: "named-by-capabilities" },
    ]);
    const { page, state, nonce } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
    expect(storage.get(`state_${state}`)).toBe(state);
    expect(storage.get(`nonce_${nonce}`)).toBe(nonce);
    expect(capabilities.asked).toStrictEqual([{ subject: "lti.capabilities", origin }]);
  });

  it("stores in the frame of lti_storage_target when the capabilities name no frame for the message", async () => {
    const storage = new PlatformStorage(await storageFrame("lti-storage"));
    new Capabilities([{ subject: "lti.put_data" }, { subject: "lti.get_data", frame: "elsewhere" }]);
    const { page, state } = await login("lti-storage");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
    expect(storage.get(`state_${state}`)).toBe(state);
  });

  it("ignores an answer to the capabilities of another request", async () => {
    const storage = new PlatformStorage(window);
    new Capabilities([{ subject: "lti.put_data", frame: "no-such-frame" }], "another-request");
    const { page } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
  });

  it("does not go on when a frame of another origin answers for the platform", async () => {
    const storage = new PlatformStorage(window);
    const { page } = await login("_parent");
    const frame = await load(page);
    await waitFor(() => expect(storage.requests).toHaveLength(2));
    await probe("intruder", frame, spoofed(storage, ""));
    await quiet();
    expect(frame.contentWindow?.location.href).toBe("about:srcdoc");
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
  });

  it("does not take an error that answers no message of its own for a failure", async () => {
    const storage = new PlatformStorage(window);
    const { page } = await login("_parent");
    const frame = await load(page);
    // The page listens for answers once it has found the frame and asked it.
    await waitFor(() => expect(storage.requests).toHaveLength(2));
    const unrelated = { subject: "lti.put_data.response", message_id: "unrelated", error: { code: "x", message: "y" } };
    frame.contentWindow?.postMessage(unrelated, "*");
    await quiet();
    expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(true);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
  });

  it("posts the state and the nonce to no frame of another origin, though it has the name of the storage", async () => {
    const { id } = await probe("stolen");
    const { page } = await login("stolen");
    await load(page);
    await quiet();
    expect(await seenBy(id)).toStrictEqual([]);
  });
});

describe("the verification page", () => {
  /** Logs in and returns the verification page that the launch answers the platform's post with. */
  async function verification(target: string): Promise<{ page: HttpResponse; state: string; nonce: string }> {
    const { state, nonce, ctx } = await login(target);
    const body = new TextEncoder().encode(
      new URLSearchParams([
        ["id_token", "header.payload.signature"],
        ["state", state],
      ]).toString(),
    );
    const page = await ltiLaunch(
      {
        method: "POST",
        url: registration.redirectUri,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      ctx.options,
    );
    if (!("status" in page)) throw new Error("The launch answered with a launch, not a page.");
    return { page, state, nonce };
  }

  /** Listens in the frame for the submit that the page ends with, and holds the form it would post. */
  function submission(frame: HTMLIFrameElement): { submitted: () => FormData | undefined } {
    let form: FormData | undefined;
    frame.contentDocument?.addEventListener("submit", (event) => {
      event.preventDefault();
      const element = frame.contentDocument?.querySelector("form");
      if (element) form = new FormData(element);
    });
    return { submitted: () => form };
  }

  it("fetches state and nonce from the platform and posts them with the token", async () => {
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    const frame = await load(page);
    const { submitted } = submission(frame);
    storage.release();
    await waitFor(() => expect(submitted()).toBeDefined());
    expect(Object.fromEntries(submitted() ?? [])).toEqual({
      id_token: "header.payload.signature",
      state,
      stored_state: state,
      stored_nonce: nonce,
    });
    expect(frame.contentDocument?.querySelector("form")?.getAttribute("action")).toBe(registration.redirectUri);
  });

  it("posts nothing and tells the user when the platform does not hold the values", async () => {
    const storage = new PlatformStorage(window);
    const { page } = await verification("_parent");
    const frame = await load(page);
    const { submitted } = submission(frame);
    storage.release();
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
    expect(submitted()).toBeUndefined();
  });

  it("posts nothing when the platform has no frame of the given name", async () => {
    const { page } = await verification("no-such-frame");
    const frame = await load(page);
    const { submitted } = submission(frame);
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
    expect(submitted()).toBeUndefined();
  });

  it("fetches the values from the frame that the platform names in its capabilities", async () => {
    const storage = new PlatformStorage(await storageFrame("named-by-capabilities"));
    const capabilities = new Capabilities([{ subject: "lti.get_data", frame: "named-by-capabilities" }]);
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    const frame = await load(page);
    const { submitted } = submission(frame);
    storage.release();
    await waitFor(() => expect(submitted()).toBeDefined());
    expect(Object.fromEntries(submitted() ?? [])).toMatchObject({ stored_state: state, stored_nonce: nonce });
    expect(capabilities.asked).toStrictEqual([{ subject: "lti.capabilities", origin }]);
  });

  it("takes the values from the platform and not from a frame of another origin that answers first", async () => {
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    const frame = await load(page);
    const { submitted } = submission(frame);
    await waitFor(() => expect(storage.requests).toHaveLength(2));
    await probe("intruder", frame, spoofed(storage, "spoofed"));
    await quiet();
    expect(submitted()).toBeUndefined();
    storage.release();
    await waitFor(() => expect(submitted()).toBeDefined());
    expect(Object.fromEntries(submitted() ?? [])).toMatchObject({ stored_state: state, stored_nonce: nonce });
  });

  it("does not take an error that answers no message of its own for a failure", async () => {
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    const frame = await load(page);
    const { submitted } = submission(frame);
    // The page listens for answers once it has found the frame and asked it.
    await waitFor(() => expect(storage.requests).toHaveLength(2));
    const unrelated = { subject: "lti.get_data.response", message_id: "unrelated", error: { code: "x", message: "y" } };
    frame.contentWindow?.postMessage(unrelated, "*");
    await quiet();
    expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(true);
    storage.release();
    await waitFor(() => expect(submitted()).toBeDefined());
  });

  it("posts nothing when the platform answers with a value that is not a string", async () => {
    const storage = new PlatformStorage(window, { badValue: true });
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    const frame = await load(page);
    const { submitted } = submission(frame);
    storage.release();
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
    expect(submitted()).toBeUndefined();
  });

  it("posts from the origin of the tool, which ltiLaunch checks, when the browser runs it with the headers of its answer", async () => {
    // The page is served by a server of its own, with the headers that ltiLaunch gave it, so that the browser applies its
    // referrer policy to the post as it would in a launch; the frames of the other tests load it from text, without them.
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    storage.release();
    const address = `${other}/page?id=${crypto.randomUUID()}`;
    const body = textOf(page.body)
      .replaceAll(registration.redirectUri, `${other}/lti/launch`)
      .replaceAll(PLATFORM, origin);
    await fetch(address, { method: "POST", body: JSON.stringify({ headers: page.headers, body }) });
    const frame = document.createElement("iframe");
    frame.src = address;
    frames.push(frame);
    document.body.append(frame);
    await waitFor(async () => expect(await requestsTo(other)).toContain(`POST /lti/launch origin=${other}`));
  });

  it("asks no frame of another origin for the values, though it has the name of the storage", async () => {
    const { id } = await probe("stolen");
    const { page } = await verification("stolen");
    await load(page);
    await quiet();
    expect(await seenBy(id)).toStrictEqual([]);
  });
});
