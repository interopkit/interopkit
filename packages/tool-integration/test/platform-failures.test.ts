// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.

import type { CallOptions } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LtiError } from "../src/index.js";
import { agsScores, ltiPlatformAuthorize, ltiPlatformLogin, platformToken } from "../src/platform/index.js";
import { openToken, sealToken } from "../src/platform/internal.js";
import { authenticationRequest, clientAssertion, tokenRequest } from "./fake-tool.js";
import { readToken } from "./fixture.js";
import {
  accessToken,
  baseLaunch,
  begin,
  endpoints,
  hintKey,
  lineItemOf,
  readPost,
  SCORE,
  SCORE_TYPE,
  scoreBody,
  service,
  setup,
  toolKeys,
} from "./platform-setup.js";

afterEach(() => vi.useRealTimers());

const DOWN = new Error("The host is down.");
const REASON = new Error("The candidate left the item.");

describe("ports that fail", () => {
  it("makes ltiPlatformLogin reject with the error of the registration lookup, and sign nothing", async () => {
    const ctx = setup();
    await expect(ltiPlatformLogin(baseLaunch, { ...ctx.login, registration: () => Promise.reject(DOWN) })).rejects.toBe(
      DOWN,
    );
  });

  it("makes ltiPlatformAuthorize fail closed when the client lookup or once rejects, and issue no token", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    await expect(ltiPlatformAuthorize(get, { ...ctx.authorize, client: () => Promise.reject(DOWN) })).rejects.toBe(
      DOWN,
    );
    await expect(ltiPlatformAuthorize(get, { ...ctx.authorize, once: () => Promise.reject(DOWN) })).rejects.toBe(DOWN);
    expect(readPost(await ltiPlatformAuthorize(get, ctx.authorize)).idToken).toBeTruthy();
  });

  it("refuses a hint that once has seen, with the status of a request that is not bound to a launch", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    await ltiPlatformAuthorize(get, ctx.authorize);
    await expect(ltiPlatformAuthorize(get, ctx.authorize)).rejects.toMatchObject({
      name: "LtiError",
      reason: "hint-used",
      status: 403,
    });
  });

  it("spends the hint before it signs, so that a later failure costs a new login and never a second use", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    const seen: string[] = [];
    const once = async (id: string, expiresAt: number) => {
      seen.push(id);
      return ctx.authorize.once(id, expiresAt);
    };
    await ltiPlatformAuthorize(get, { ...ctx.authorize, once });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^hint:/u);
  });

  it("makes platformToken fail closed when once or the client lookup rejects, and grant no token", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const post = tokenRequest(endpoints.token, assertion, SCORE);
    await expect(platformToken(post, { ...ctx.token, once: () => Promise.reject(DOWN) })).rejects.toBe(DOWN);
    await expect(platformToken(post, { ...ctx.token, client: () => Promise.reject(DOWN) })).rejects.toBe(DOWN);
    const granted = await platformToken(post, ctx.token);
    expect(granted.status).toBe(200);
  });

  it("makes agsScores reject when onScore rejects, and passes every check again on the retry", async () => {
    const ctx = setup();
    const lineItem = await lineItemOf(ctx);
    const bearer = await accessToken(ctx, SCORE);
    const post = () =>
      service(`${lineItem}/scores`, bearer, {
        method: "POST",
        headers: { "content-type": SCORE_TYPE },
        body: scoreBody(),
      });
    await expect(agsScores(post(), { ...ctx.scoring, onScore: () => Promise.reject(DOWN) })).rejects.toBe(DOWN);
    expect(ctx.scores).toStrictEqual([]);
    expect((await agsScores(post(), ctx.scoring)).status).toBe(204);
    expect(ctx.scores).toHaveLength(1);
  });
});

describe("the status of an LtiError of the platform role", () => {
  it("is 403 for a request that is not bound to a launch of this platform, and 400 for a broken protocol", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    parameters.set("scope", "profile");
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize),
    ).rejects.toMatchObject({ reason: "scope-invalid", status: 400 });
    const unbound = await begin(ctx);
    unbound.parameters.set("lti_message_hint", "not-a-hint");
    await expect(
      ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, unbound.parameters), ctx.authorize),
    ).rejects.toMatchObject({ reason: "hint-invalid", status: 403 });
  });
});

describe("signals on the platform role", () => {
  /** Ports that record the signal each receives. */
  function spying(ctx: ReturnType<typeof setup>, signal: AbortSignal | undefined) {
    const seen: Record<string, (AbortSignal | undefined)[]> = {
      check: [],
      registration: [],
      client: [],
      once: [],
      checkLaunch: [],
    };
    const note = (name: string, call?: CallOptions): void => {
      seen[name]?.push(call?.signal);
    };
    return {
      seen,
      login: {
        ...ctx.login,
        signal,
        check: async (...args: Parameters<typeof ctx.login.check>) => {
          note("check", args[1]);
          return ctx.login.check(args[0]);
        },
        registration: async (...args: Parameters<typeof ctx.login.registration>) => {
          note("registration", args[1]);
          return ctx.login.registration(args[0]);
        },
      },
      authorize: {
        ...ctx.authorize,
        signal,
        client: async (id: string, call?: CallOptions) => {
          note("client", call);
          return ctx.authorize.client(id);
        },
        once: async (id: string, at: number, call?: CallOptions) => {
          note("once", call);
          return ctx.authorize.once(id, at);
        },
        checkLaunch: async (_who: unknown, call?: CallOptions) => {
          note("checkLaunch", call);
        },
      },
    };
  }

  it("hands the signal to check and registration of the login, and to client, checkLaunch and once of the authorization", async () => {
    const ctx = setup();
    const { signal } = new AbortController();
    const spy = spying(ctx, signal);
    const url = await ltiPlatformLogin(baseLaunch, spy.login);
    expect(url).toContain("lti_message_hint");
    expect(spy.seen.check).toStrictEqual([signal]);
    expect(spy.seen.registration).toStrictEqual([signal]);
    const { parameters } = await begin(ctx);
    await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), spy.authorize);
    expect(spy.seen.client).toStrictEqual([signal]);
    expect(spy.seen.checkLaunch).toStrictEqual([signal]);
    expect(spy.seen.once).toStrictEqual([signal]);
  });

  it("rejects the login with the reason when the signal aborts in check, and looks up no tool", async () => {
    const ctx = setup();
    const controller = new AbortController();
    let looked = 0;
    const options = {
      ...ctx.login,
      signal: controller.signal,
      check: async () => controller.abort(REASON),
      registration: async (...args: Parameters<typeof ctx.login.registration>) => {
        looked += 1;
        return ctx.login.registration(args[0]);
      },
    };
    await expect(ltiPlatformLogin(baseLaunch, options)).rejects.toBe(REASON);
    expect(looked).toBe(1);
  });

  it("leaves the hint unspent when the signal aborts before once, and spent when it aborts in once", async () => {
    const ctx = setup();
    const { parameters } = await begin(ctx);
    const get = authenticationRequest(endpoints.authorization, parameters);
    const early = new AbortController();
    const checkLaunch = async () => early.abort(REASON);
    await expect(ltiPlatformAuthorize(get, { ...ctx.authorize, signal: early.signal, checkLaunch })).rejects.toBe(
      REASON,
    );
    expect(ctx.used.size).toBe(0);
    const late = new AbortController();
    const once = async (id: string, at: number) => {
      const fresh = await ctx.authorize.once(id, at);
      late.abort(REASON);
      return fresh;
    };
    await expect(ltiPlatformAuthorize(get, { ...ctx.authorize, signal: late.signal, once })).rejects.toBe(REASON);
    expect(ctx.used.size).toBe(1);
    await expect(ltiPlatformAuthorize(get, ctx.authorize)).rejects.toMatchObject({ reason: "hint-used" });
  });

  it("spends the assertion when the signal aborts in once, and the tool asks again with a new one", async () => {
    const ctx = setup();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const post = tokenRequest(endpoints.token, assertion, SCORE);
    const controller = new AbortController();
    const once = async (id: string, at: number) => {
      const fresh = await ctx.token.once(id, at);
      controller.abort(REASON);
      return fresh;
    };
    await expect(platformToken(post, { ...ctx.token, signal: controller.signal, once })).rejects.toBe(REASON);
    const replay = await platformToken(post, ctx.token);
    expect(replay.status).toBe(400);
    const again = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    expect((await platformToken(tokenRequest(endpoints.token, again, SCORE), ctx.token)).status).toBe(200);
  });

  it("hands the signal to onScore", async () => {
    const ctx = setup();
    const lineItem = await lineItemOf(ctx);
    const bearer = await accessToken(ctx, SCORE);
    const { signal } = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const onScore = async (_resource: string, _score: unknown, call?: CallOptions): Promise<void> => {
      seen.push(call?.signal);
    };
    const post = service(`${lineItem}/scores`, bearer, {
      method: "POST",
      headers: { "content-type": SCORE_TYPE },
      body: scoreBody(),
    });
    await agsScores(post, { ...ctx.scoring, signal, onScore });
    expect(seen).toStrictEqual([signal]);
  });
});

describe("sealed tokens", () => {
  const claims = { principal: "candidate-7" };

  it("round-trips the claims for the use and the key they were sealed with", async () => {
    const token = await sealToken("login", claims, hintKey);
    expect(readToken(token).header).toEqual({ alg: "HS256", typ: "login" });
    expect(await openToken(token, "login", hintKey)).toEqual(claims);
  });

  it("refuses a token for another use, so that a hint cannot stand for an access token", async () => {
    const token = await sealToken("hint", claims, hintKey);
    expect(await openToken(token, "access", hintKey)).toBeUndefined();
  });

  it("refuses a token sealed with another key", async () => {
    const other = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    expect(await openToken(await sealToken("login", claims, other), "login", hintKey)).toBeUndefined();
  });

  it("verifies the MAC with WebCrypto, which compares in constant time, and with no comparison of its own", async () => {
    const token = await sealToken("login", claims, hintKey);
    const verify = vi.spyOn(crypto.subtle, "verify");
    await openToken(token, "login", hintKey);
    const [algorithm, key] = verify.mock.calls[0] ?? [];
    expect(typeof algorithm === "string" ? algorithm : (algorithm as { name: string }).name).toBe("HMAC");
    expect(key).toBe(hintKey);
    verify.mockRestore();
  });

  it("refuses a token whose header names another algorithm, even with a MAC that fits", async () => {
    const [, payload = "", mac = ""] = (await sealToken("login", claims, hintKey)).split(".");
    for (const alg of ["none", "HS384", "RS256"]) {
      const header = Buffer.from(JSON.stringify({ alg, typ: "login" })).toString("base64url");
      expect(await openToken(`${header}.${payload}.${mac}`, "login", hintKey), alg).toBeUndefined();
    }
  });

  it("refuses a token with a changed payload or a changed MAC, and one spelled another way", async () => {
    const token = await sealToken("login", claims, hintKey);
    const [header = "", payload = "", mac = ""] = token.split(".");
    const changed = Buffer.from(JSON.stringify({ principal: "someone-else" })).toString("base64url");
    expect(await openToken(`${header}.${changed}.${mac}`, "login", hintKey)).toBeUndefined();
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(await openToken(`${header}.${payload}.${flipped}`, "login", hintKey)).toBeUndefined();
    expect(await openToken(` ${token}`, "login", hintKey)).toBeUndefined();
    expect(await openToken(`${header}.${payload}.${mac}=`, "login", hintKey)).toBeUndefined();
  });

  it("refuses text that is not a token, without throwing", async () => {
    for (const text of ["", "a.b", "a.b.c", "....", "x".repeat(10_000)]) {
      expect(await openToken(text, "login", hintKey), text.slice(0, 8)).toBeUndefined();
    }
  });
});

describe("LtiError", () => {
  it("is the error of every refusal of the platform role", () => {
    expect(new LtiError("The hint is used.", "hint-used").status).toBe(403);
  });
});
