// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import { describe, expect, it } from "vitest";
import { handleLaunch, handleLogin, type LtiStore } from "../src/tool/index.js";
import { textOf } from "./text-of.js";

import { cookieLogin, type Setup, setup } from "./tool-setup.js";

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
  it("makes handleLogin reject and send no redirect when put rejects", async () => {
    const ctx = setup();
    const options = withStore(ctx, { put: () => Promise.reject(DOWN) });
    await expect(handleLogin(ctx.platform.initiation(), options)).rejects.toBe(DOWN);
    expect(ctx.store.records.size).toBe(0);
  });

  it("makes handleLaunch reject when get rejects, and the login stays", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    await expect(handleLaunch(post, withStore(ctx, { get: () => Promise.reject(DOWN) }))).rejects.toBe(DOWN);
    expect(ctx.store.records.size).toBe(1);
  });

  it("makes handleLaunch reject after validation when delete rejects, so that the platform may post again", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    await expect(handleLaunch(post, withStore(ctx, { delete: () => Promise.reject(DOWN) }))).rejects.toBe(DOWN);
    expect(ctx.store.records.size).toBe(1);
    expect(await handleLaunch(post, ctx.options)).toMatchObject({ messageType: "LtiResourceLinkRequest" });
    expect(ctx.store.records.size).toBe(0);
  });

  it("gives each login a new state, so that a repeated initiation never reuses a record", async () => {
    const ctx = setup();
    await handleLogin(ctx.platform.initiation(), ctx.options);
    await handleLogin(ctx.platform.initiation(), ctx.options);
    expect(new Set(ctx.store.records.keys()).size).toBe(2);
  });

  it("lets only one of two launches with one token complete, whatever the order of the deletes", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const results = await Promise.allSettled([handleLaunch(post, ctx.options), handleLaunch(post, ctx.options)]);
    const reasons = results.map((result) =>
      result.status === "rejected" ? (result.reason as { reason?: string }).reason : "launch",
    );
    expect(reasons.toSorted()).toStrictEqual(["launch", "state-reused"]);
  });
});

describe("a registration lookup that fails", () => {
  it("rejects the caller of handleLogin, handleLaunch and the tokens with the error of the lookup", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx);
    const failing = { ...ctx.options, registration: () => Promise.reject(DOWN) };
    await expect(handleLogin(ctx.platform.initiation(), failing)).rejects.toBe(DOWN);
    await expect(handleLaunch(post, failing)).rejects.toBe(DOWN);
  });

  it("is unknown to the platform when it answers undefined, with the status of a request that is not bound to a login", async () => {
    const ctx = setup();
    const unknown = { ...ctx.options, registration: () => Promise.resolve(undefined) };
    await expect(handleLogin(ctx.platform.initiation(), unknown)).rejects.toMatchObject({
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
    await expect(handleLaunch(bare, ctx.options)).rejects.toMatchObject({ reason: "state-cookie", status: 403 });
    ctx.store.records.clear();
    await expect(handleLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "state-unknown", status: 403 });
  });

  it("is 401 when a token fails validation, and 400 when the sender broke the protocol otherwise", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { claims: { nonce: "other" } });
    await expect(handleLaunch(post, ctx.options)).rejects.toMatchObject({ reason: "nonce-mismatch", status: 401 });
    const legacy = { ...post, body: new TextEncoder().encode(`${textOf(post.body)}&oauth_consumer_key=k`) };
    await expect(handleLaunch(legacy, ctx.options)).rejects.toMatchObject({ reason: "legacy-launch", status: 400 });
  });
});
