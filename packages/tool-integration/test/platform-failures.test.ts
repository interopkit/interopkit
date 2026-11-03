import { type CallOptions, DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { describe, expect, it, vi } from "vitest";
import { type MessageInput, prepareToolLaunch, type ToolRegistration } from "../src/platform/index.js";
import { openToken, sealToken } from "../src/platform/internal.js";
import { authenticationRequest, clientAssertion, TOOL_CLIENT_ID, tokenRequest, toolRegistration } from "./fake-tool.js";
import { generateKeyPair, readPost } from "./fixture.js";
import {
  authorize,
  baseMessage,
  begin,
  config,
  endpoints,
  handle,
  hintKey,
  type Setup,
  setup,
  toolKeys,
} from "./platform-setup.js";
import { textOf } from "./text-of.js";

/** Whether an answer is the 500 of a failed port, which says nothing of the cause. */
function isServerError(response: HttpResponse): boolean {
  return response.status === 500 && !textOf(response.body).includes("cause");
}

/** A port that never settles and records the signal it received. */
function hanging(signals: (AbortSignal | undefined)[]) {
  return (...args: unknown[]): Promise<never> => {
    const options = args.at(-1) as CallOptions | undefined;
    signals.push(options?.signal);
    return new Promise(() => undefined);
  };
}

describe("the login when a port of the host fails", () => {
  it("rejects with the failure of the store and signs nothing", async () => {
    const ctx = setup();
    const failure = new Error("cause: the store is down");
    await expect(
      prepareToolLaunch(baseMessage, {
        ...ctx.login,
        launches: { ...ctx.login.launches, put: () => Promise.reject(failure) },
      }),
    ).rejects.toBe(failure);
  });

  it("passes the signal to every port it calls", async () => {
    const ctx = setup();
    const signal = new AbortController().signal;
    const seen: (AbortSignal | undefined)[] = [];
    const record =
      <T>(value: T) =>
      async (...args: unknown[]) => {
        seen.push((args.at(-1) as CallOptions | undefined)?.signal);
        return value;
      };
    await prepareToolLaunch(baseMessage, {
      ...ctx.login,
      signal,
      check: record(undefined),
      registration: record(toolRegistration()),
      launches: { put: record(undefined), take: record(undefined) },
    });
    expect(seen).toEqual([signal, signal, signal]);
  });

  it("rejects with the reason of the signal before the message is kept", async () => {
    const ctx = setup();
    const controller = new AbortController();
    const reason = new Error("gone");
    const check = async () => controller.abort(reason);
    await expect(prepareToolLaunch(baseMessage, { ...ctx.login, signal: controller.signal, check })).rejects.toBe(
      reason,
    );
    expect(ctx.kept.size).toBe(0);
  });

  it("throws DataError for a registration that is not one, or that is another tool's", async () => {
    const ctx = setup();
    const weak = await generateKeyPair("weak", 1024);
    const cases: unknown[] = [
      { ...toolRegistration(), deploymentIds: [] },
      { ...toolRegistration(), keys: new Map(), jwksUrl: undefined, scopes: [] },
      { ...toolRegistration(), keys: new Map([["k", toolKeys.privateKey]]), jwksUrl: undefined },
      { ...toolRegistration(), algorithms: ["HS256"] },
      { ...toolRegistration(), scopes: "all" },
      { ...toolRegistration(), clientId: "someone-else" },
      { ...toolRegistration(), allow: "camera <script>" },
      { ...toolRegistration(), redirectUris: ["http://tool.example.com/lti/launch"] },
      { ...toolRegistration(), keys: new Map([[weak.kid, weak.publicKey]]), jwksUrl: undefined },
    ];
    for (const registration of cases) {
      await expect(
        prepareToolLaunch(baseMessage, { ...ctx.login, registration: async () => registration as ToolRegistration }),
      ).rejects.toThrow(DataError);
    }
    expect(ctx.kept.size).toBe(0);
  });
});

describe("the authentication request when a port of the host fails", () => {
  it("answers 500 when the lookup of the tool fails, and takes nothing", async () => {
    const ctx = setup();
    const page = await authorize(ctx, undefined, {
      requests: { client: () => Promise.reject(new Error("cause: the database is down")) },
    });
    expect(isServerError(page)).toBe(true);
    expect(ctx.kept.size).toBe(1);
  });

  it("answers 500 when checkLaunch fails, and keeps the message", async () => {
    const ctx = setup();
    const page = await authorize(ctx, undefined, {
      requests: { checkLaunch: () => Promise.reject(new Error("cause")) },
    });
    expect(isServerError(page)).toBe(true);
    expect(ctx.kept.size).toBe(1);
  });

  it("throws DataError when checkLaunch gives something other than a boolean", async () => {
    const ctx = setup();
    await expect(authorize(ctx, undefined, { requests: { checkLaunch: async () => "yes" as never } })).rejects.toThrow(
      "checkLaunch must resolve with a boolean",
    );
  });

  it("answers 500 when the store fails to take the message, and signs nothing", async () => {
    const ctx = setup();
    const page = await authorize(ctx, undefined, {
      requests: { launches: { ...ctx.requests.launches, take: () => Promise.reject(new Error("cause")) } },
    });
    expect(isServerError(page)).toBe(true);
    expect(textOf(page.body)).not.toContain("id_token");
  });

  it("throws DataError when the store gives back something that is not the message of the launch", async () => {
    const other: MessageInput = { ...baseMessage, user: { subject: "someone-else" } };
    for (const taken of [
      { messageType: "LtiResourceLinkRequest" },
      other,
      { ...baseMessage, deploymentId: "deployment-2" },
    ]) {
      const ctx = setup();
      const launches = { ...ctx.requests.launches, take: async () => taken as MessageInput };
      await expect(authorize(ctx, undefined, { requests: { launches } })).rejects.toThrow(DataError);
    }
  });

  it("answers 500 when the substitution of the host fails, and throws DataError when it gives other than a string", async () => {
    const ctx = setup();
    const message = { ...baseMessage, custom: { begin: "$CourseSection.timeFrame.begin" } };
    const failing = { names: ["CourseSection.timeFrame.begin"], resolve: () => Promise.reject(new Error("cause")) };
    expect(isServerError(await authorize(ctx, undefined, { message, requests: { substitution: failing } }))).toBe(true);
    const asked: unknown[] = [];
    const wrong = {
      names: ["CourseSection.timeFrame.begin"],
      resolve: async (...args: unknown[]) => {
        asked.push(args.slice(0, 3));
        return 5 as never;
      },
    };
    await expect(authorize(setup(), undefined, { message, requests: { substitution: wrong } })).rejects.toThrow(
      "must resolve with a string or undefined",
    );
    expect(asked).toEqual([["CourseSection.timeFrame.begin", message, toolRegistration()]]);
  });

  it("answers 500 when migrationSecret fails, and throws DataError when it gives other than a string", async () => {
    const message = { ...baseMessage, migration: { oauthConsumerKey: "key-1" } };
    const failed = await authorize(setup(), undefined, {
      message,
      requests: { migrationSecret: () => Promise.reject(new Error("cause")) },
    });
    expect(isServerError(failed)).toBe(true);
    await expect(
      authorize(setup(), undefined, { message, requests: { migrationSecret: async () => 7 as never } }),
    ).rejects.toThrow("migrationSecret must resolve with a string or undefined");
  });

  it("answers 500 when the signer fails, and the launch is spent", async () => {
    const ctx = setup();
    const signer = { ...config.keys.signer, sign: () => Promise.reject(new Error("cause: the KMS is down")) };
    const page = await authorize(ctx, undefined, {
      requests: { config: { ...config, keys: { ...config.keys, signer } } },
    });
    expect(isServerError(page)).toBe(true);
    expect(ctx.kept.size).toBe(0);
  });

  it("rejects with the reason of the signal while a port hangs: before take the message stays, after it the launch is spent", async () => {
    const ctx = setup();
    const signals: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const reason = new Error("the browser left");
    const pending = authorize(ctx, undefined, {
      requests: { signal: controller.signal, checkLaunch: hanging(signals) },
    });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(signals).toEqual([controller.signal]);
    expect(ctx.kept.size).toBe(1);

    const after = setup();
    const late = new AbortController();
    const substitution = { names: ["X.y"], resolve: hanging(signals) };
    const spent = authorize(after, undefined, {
      message: { ...baseMessage, custom: { x: "$X.y" } },
      requests: { signal: late.signal, substitution },
    });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    late.abort(reason);
    await expect(spent).rejects.toBe(reason);
    expect(after.kept.size).toBe(0);
  });
});

describe("the token endpoint when a port of the host fails", () => {
  /** A token request of the first tool. */
  async function tokenOf(ctx: Setup) {
    return tokenRequest(endpoints.token, await clientAssertion(toolKeys, endpoints.token, ctx.clock), "s");
  }

  it("answers 500 when the lookup of the tool or once fails, and issues no token", async () => {
    const ctx = setup();
    expect(
      isServerError(await handle(ctx, await tokenOf(ctx), { client: () => Promise.reject(new Error("cause")) })),
    ).toBe(true);
    expect(
      isServerError(await handle(ctx, await tokenOf(ctx), { once: () => Promise.reject(new Error("cause")) })),
    ).toBe(true);
    expect(ctx.used.size).toBe(0);
  });

  it("throws DataError when once gives something other than a boolean, or the lookup another tool", async () => {
    const ctx = setup();
    await expect(handle(ctx, await tokenOf(ctx), { once: async () => "yes" as never })).rejects.toThrow(
      "once must resolve with a boolean",
    );
    await expect(
      handle(ctx, await tokenOf(ctx), { client: async () => toolRegistration({ clientId: "other" }) }),
    ).rejects.toThrow(DataError);
  });
});

describe("the sealed tokens", () => {
  it("are opened for their own use only, so that a token of one use is refused for another", async () => {
    const ctx = setup();
    const { parameters, initiation } = await begin(ctx);
    const claims = await openToken(initiation.messageHint, "hint", [hintKey]);
    for (const use of ["login", "access", "session-data", "deep-linking-data"] as const) {
      const changed = new URLSearchParams(parameters);
      changed.set("lti_message_hint", await sealToken(use, claims ?? {}, hintKey));
      const page = await handle(ctx, authenticationRequest(endpoints.authorization, changed));
      expect(readPost(page).fields.get("error"), use).toBe("login_required");
    }
    expect(await openToken(initiation.loginHint, "hint", [hintKey])).toBeUndefined();
    expect(TOOL_CLIENT_ID).toBe(claims?.client);
  });
});
