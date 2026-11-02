// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { type CallOptions, DataError } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJwksCache } from "../src/index.js";
import { deepLinkResponse, type LtiStore, ltiLaunch, ltiLogin } from "../src/tool/index.js";
import { requestServiceToken } from "../src/tool/internal.js";
import { DEPLOYMENT_ID, JWKS_URL } from "./fake-platform.js";
import { cookieLogin, deepLinkingOf, type Setup, setup } from "./tool-setup.js";
import { waitFor } from "./wait.js";

afterEach(() => vi.useRealTimers());

const REASON = new Error("The candidate left the item.");

/** A promise and the means to settle it from outside. */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

/** The signals that the ports of a setup received, by port. */
interface Seen {
  readonly lookup: (AbortSignal | undefined)[];
  readonly put: (AbortSignal | undefined)[];
  readonly get: (AbortSignal | undefined)[];
  readonly delete: (AbortSignal | undefined)[];
}

/** Options that record the signal each port receives, and carry the given signal. */
function spying(
  ctx: Setup,
  signal: AbortSignal | undefined,
): { readonly options: Setup["options"]; readonly seen: Seen } {
  const seen: Seen = { lookup: [], put: [], get: [], delete: [] };
  const store: LtiStore = {
    put: async (state, record, call) => {
      seen.put.push(call?.signal);
      return ctx.store.put(state, record);
    },
    get: async (state, call) => {
      seen.get.push(call?.signal);
      return ctx.store.get(state);
    },
    delete: async (state, call) => {
      seen.delete.push(call?.signal);
      return ctx.store.delete(state);
    },
  };
  const registration = async (issuer: string, clientId: string | undefined, call?: CallOptions) => {
    seen.lookup.push(call?.signal);
    return ctx.options.registration(issuer, clientId);
  };
  return { options: { ...ctx.options, store, registration, signal }, seen };
}

describe("ltiLogin and a signal", () => {
  it("hands the signal to the registration lookup and to the store", async () => {
    const ctx = setup();
    const { signal } = new AbortController();
    const { options, seen } = spying(ctx, signal);
    await ltiLogin(ctx.platform.initiation(), options);
    expect(seen.lookup).toStrictEqual([signal]);
    expect(seen.put).toStrictEqual([signal]);
  });

  it("rejects with the reason of an aborted signal and saves nothing", async () => {
    const ctx = setup();
    const { options, seen } = spying(ctx, AbortSignal.abort(REASON));
    await expect(ltiLogin(ctx.platform.initiation(), options)).rejects.toBe(REASON);
    expect(seen.put).toStrictEqual([]);
    expect(ctx.store.records.size).toBe(0);
  });
});

describe("ltiLaunch and a signal", () => {
  it("hands the signal to the lookup, the store and the key set", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const { signal } = new AbortController();
    const { options, seen } = spying(ctx, signal);
    await ltiLaunch(post, options);
    expect(seen.lookup).toStrictEqual([signal]);
    expect(seen.get).toStrictEqual([signal]);
    expect(seen.delete).toStrictEqual([signal]);
  });

  it("rejects with the reason before the login is deleted, so that the login stays and the platform may post again", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const controller = new AbortController();
    const realKeys = ctx.options.jwks;
    // The abort arrives once the token is verified, which is the last step before the delete.
    const jwks = {
      keySet: (url: string, call?: CallOptions) => {
        const keys = realKeys.keySet(url, call);
        return async (...args: Parameters<typeof keys>) => {
          const key = await keys(...args);
          controller.abort(REASON);
          return key;
        };
      },
    };
    const { options, seen } = spying({ ...ctx, options: { ...ctx.options, jwks } }, controller.signal);
    await expect(ltiLaunch(post, options)).rejects.toBe(REASON);
    expect(seen.delete).toStrictEqual([]);
    expect(ctx.store.records.size).toBe(1);
    expect(await ltiLaunch(post, ctx.options)).toMatchObject({ messageType: "LtiResourceLinkRequest" });
  });

  it("ends the wait for a key set that is slow, and lets the fetch run on", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const gate = deferred<void>();
    ctx.platform.keySetResponse = async () => {
      await gate.promise;
      return Response.json({ keys: ctx.platform.published.map((key) => key.publicJwk) });
    };
    const controller = new AbortController();
    const wait = ltiLaunch(post, { ...ctx.options, signal: controller.signal });
    await waitFor(() => expect(ctx.platform.requests).toContain(`GET ${JWKS_URL}`));
    controller.abort(REASON);
    await expect(wait).rejects.toBe(REASON);
    gate.resolve();
    expect(await ltiLaunch(post, ctx.options)).toMatchObject({ messageType: "LtiResourceLinkRequest" });
    expect(ctx.platform.requests.filter((request) => request === `GET ${JWKS_URL}`)).toHaveLength(1);
  });
});

describe("a key set cache and a signal", () => {
  it("ends the wait of the caller whose signal aborts, and no other, on one shared fetch", async () => {
    const { platform } = setup();
    const gate = deferred<void>();
    platform.keySetResponse = async () => {
      await gate.promise;
      return Response.json({ keys: platform.published.map((key) => key.publicJwk) });
    };
    const cache = createJwksCache({ fetch: platform.fetch });
    const header = { alg: "RS256", kid: "platform-1" } as const;
    const jws = { payload: "", signature: "" };
    const leaving = new AbortController();
    const ended = cache.keySet(JWKS_URL, { signal: leaving.signal })(header, jws);
    const staying = cache.keySet(JWKS_URL, { signal: new AbortController().signal })(header, jws);
    const unbound = cache.keySet(JWKS_URL)(header, jws);
    leaving.abort(REASON);
    await expect(ended).rejects.toBe(REASON);
    gate.resolve();
    expect(await staying).toBeDefined();
    expect(await unbound).toBeDefined();
    expect(platform.requests).toHaveLength(1);
  });
});

describe("the request of a service token and a signal", () => {
  const scopes = ["https://purl.imsglobal.org/spec/lti-ags/scope/score"];
  const request = (ctx: ReturnType<typeof setup>, signal: AbortSignal) =>
    requestServiceToken(ctx.registration, DEPLOYMENT_ID, scopes, {
      fetch: ctx.platform.fetch,
      timeoutMs: 10_000,
      clock: ctx.clock,
      signal,
    });

  it("makes no request when the signal is aborted before the call", async () => {
    const ctx = setup();
    await expect(request(ctx, AbortSignal.abort(REASON))).rejects.toBe(REASON);
    expect(ctx.platform.requests).toStrictEqual([]);
  });

  it("rejects with the reason when the signal aborts while the platform has not answered", async () => {
    const ctx = setup();
    ctx.platform.tokenResponse = () => new Promise<Response>(() => undefined);
    const controller = new AbortController();
    const wait = request(ctx, controller.signal);
    await waitFor(() => expect(ctx.platform.requests.length).toBeGreaterThan(0));
    controller.abort(REASON);
    await expect(wait).rejects.toBe(REASON);
  });
});

describe("deepLinkResponse and a signal", () => {
  it("hands the signal to the registration lookup", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    const launch = deepLinkingOf(await ltiLaunch(post, ctx.options));
    const { signal } = new AbortController();
    const { options, seen } = spying(ctx, signal);
    await deepLinkResponse(launch, [], options);
    expect(seen.lookup).toStrictEqual([signal]);
  });
});

describe("the option signal", () => {
  it("is refused when it is not an AbortSignal", async () => {
    const ctx = setup();
    const options = { ...ctx.options, signal: JSON.parse('{"aborted":false}') };
    await expect(ltiLogin(ctx.platform.initiation(), options)).rejects.toStrictEqual(
      new DataError("The option signal must be an AbortSignal, found an object."),
    );
  });
});
