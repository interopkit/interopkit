// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { ServiceError } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJwksCache } from "../src/index.js";
import { type LtiStore, ltiLaunch, ltiLogin } from "../src/tool/index.js";
import { JWKS_URL } from "./fake-platform.js";
import { cookieLogin, type Setup, setup } from "./tool-setup.js";

afterEach(() => vi.useRealTimers());

/** The store of a setup with some of its functions replaced. */
function withStore(ctx: Setup, replaced: Partial<LtiStore>): Setup["options"] {
  const { store } = ctx;
  const functions: LtiStore = {
    put: (state, record) => store.put(state, record),
    get: (state) => store.get(state),
    delete: (state) => store.delete(state),
    ...replaced,
  };
  return { ...ctx.options, store: functions };
}

const DOWN = new Error("The store is down.");

describe("a store that fails", () => {
  it("makes ltiLogin reject and send no redirect when put rejects", async () => {
    const ctx = setup();
    const options = withStore(ctx, { put: () => Promise.reject(DOWN) });
    await expect(ltiLogin(ctx.platform.initiation(), options)).rejects.toBe(DOWN);
    expect(ctx.store.records.size).toBe(0);
  });

  it("makes ltiLaunch reject when get rejects, and the login stays", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    await expect(ltiLaunch(post, withStore(ctx, { get: () => Promise.reject(DOWN) }))).rejects.toBe(DOWN);
    expect(ctx.store.records.size).toBe(1);
  });

  it("makes ltiLaunch reject after validation when delete rejects, so that the platform may post again", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    await expect(ltiLaunch(post, withStore(ctx, { delete: () => Promise.reject(DOWN) }))).rejects.toBe(DOWN);
    expect(ctx.store.records.size).toBe(1);
    expect(await ltiLaunch(post, ctx.options)).toMatchObject({ messageType: "LtiResourceLinkRequest" });
    expect(ctx.store.records.size).toBe(0);
  });

  it("gives each login a new state, so that a repeated initiation never reuses a record", async () => {
    const ctx = setup();
    await ltiLogin(ctx.platform.initiation(), ctx.options);
    await ltiLogin(ctx.platform.initiation(), ctx.options);
    expect(new Set(ctx.store.records.keys()).size).toBe(2);
  });

  it("lets only one of two launches with one token complete, whatever the order of the deletes", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const results = await Promise.allSettled([ltiLaunch(post, ctx.options), ltiLaunch(post, ctx.options)]);
    const reasons = results.map((result) =>
      result.status === "rejected" ? (result.reason as { reason?: string }).reason : "launch",
    );
    expect(reasons.toSorted()).toStrictEqual(["launch", "state-reused"]);
  });
});

describe("a registration lookup that fails", () => {
  it("rejects the caller of ltiLogin, ltiLaunch and the tokens with the error of the lookup", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const failing = { ...ctx.options, registration: () => Promise.reject(DOWN) };
    await expect(ltiLogin(ctx.platform.initiation(), failing)).rejects.toBe(DOWN);
    await expect(ltiLaunch(post, failing)).rejects.toBe(DOWN);
  });

  it("is unknown to the platform when it answers undefined, with the status of a request that is not bound to a login", async () => {
    const ctx = setup();
    const unknown = { ...ctx.options, registration: () => Promise.resolve(undefined) };
    await expect(ltiLogin(ctx.platform.initiation(), unknown)).rejects.toMatchObject({
      reason: "platform-unknown",
      status: 400,
    });
  });
});

describe("the status of an LtiError", () => {
  it("is 403 when the launch is not bound to a login of the tool", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const bare = { ...post, headers: { "content-type": post.headers["content-type"] ?? "" } };
    await expect(ltiLaunch(bare, ctx.options)).rejects.toMatchObject({ reason: "state-cookie", status: 403 });
    ctx.store.records.clear();
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "state-unknown", status: 403 });
  });

  it("is 401 when a token fails validation, and 400 when the sender broke the protocol otherwise", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { claims: { nonce: "other" } });
    await expect(ltiLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "nonce-mismatch", status: 401 });
    const legacy = { ...post, body: `${post.body}&oauth_consumer_key=k` };
    await expect(ltiLaunch(legacy, ctx.options)).rejects.toMatchObject({ reason: "legacy-launch", status: 400 });
  });
});

describe("a key set cache when the platform is down", () => {
  const CACHE = { ttlSeconds: 100, refreshSeconds: 10 };
  const keyOf = (cache: ReturnType<typeof createJwksCache>) =>
    cache.keySet(JWKS_URL)({ alg: "RS256", kid: "platform-1" }, { payload: "", signature: "" });

  it("serves a key that is still fresh, and asks the platform for nothing", async () => {
    const { platform } = setup();
    const cache = createJwksCache({ fetch: platform.fetch, ...CACHE });
    const first = await keyOf(cache);
    platform.keySetResponse = () => new Response("down", { status: 503 });
    expect(await keyOf(cache)).toBe(first);
    expect(platform.requests).toHaveLength(1);
  });

  it("fails closed past the time to live: it rejects with ServiceError and never serves the stale key", async () => {
    const { platform, clock } = setup();
    const cache = createJwksCache({ fetch: platform.fetch, ...CACHE });
    await keyOf(cache);
    platform.keySetResponse = () => new Response("down", { status: 503 });
    clock.advance(CACHE.ttlSeconds);
    await expect(keyOf(cache)).rejects.toBeInstanceOf(ServiceError);
    await expect(keyOf(cache)).rejects.toMatchObject({ status: 503 });
  });
});
