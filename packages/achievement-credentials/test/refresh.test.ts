import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import type { IssuableCredential } from "../src/index.js";
import { handleRefreshRequest, refreshCredential } from "../src/refresh/index.js";
import { achievementCredential } from "./fixtures.js";
import { HOSTILE, neverParsesLarge } from "./hostile.js";
import { serve } from "./key-fixtures.js";

const SERVICE = "https://example.edu/refresh/3732";
const credentialWith = (refreshService?: unknown) =>
  ({
    ...achievementCredential(),
    ...(refreshService === undefined ? {} : { refreshService }),
  }) as unknown as IssuableCredential;
const withService = (type = "1EdTechCredentialRefresh") => credentialWith({ id: SERVICE, type });
const JWS = "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJhIn0.c2ln";

describe("refreshing a credential", () => {
  it("gets the credential that the service gives, as JSON or as a compact JWS, with a GET over HTTPS", async () => {
    const newer = { ...achievementCredential(), name: "Newer" };
    const json = serve({ [SERVICE]: newer });
    expect(await refreshCredential(withService(), { fetch: json.fetch })).toStrictEqual(newer);
    expect(json.requests).toStrictEqual([SERVICE]);
    expect(
      await refreshCredential(withService("ImsCredentialRefresh"), { fetch: serve({ [SERVICE]: `${JWS}\n` }).fetch }),
    ).toBe(JWS);
  });

  it("answers undefined for a credential with no refresh service of a type that it knows, and fetches nothing", async () => {
    const { fetch, requests } = serve({});
    expect(await refreshCredential(credentialWith(), { fetch })).toBeUndefined();
    expect(await refreshCredential(withService("SomethingElse"), { fetch })).toBeUndefined();
    expect(await refreshCredential(credentialWith("text"), { fetch })).toBeUndefined();
    expect(requests).toStrictEqual([]);
  });

  it("is a ServiceError when the service fails, answers another status, redirects or sends too much", async () => {
    for (const route of [503, 404, 204]) {
      await expect(
        refreshCredential(withService(), { fetch: serve({ [SERVICE]: route }).fetch }),
      ).rejects.toBeInstanceOf(ServiceError);
    }
    const redirect = async () => new Response("", { status: 302, headers: { location: "https://elsewhere.example/" } });
    await expect(refreshCredential(withService(), { fetch: redirect })).rejects.toBeInstanceOf(ServiceError);
    await expect(
      refreshCredential(withService(), {
        fetch: serve({ [SERVICE]: JSON.stringify({ a: "x".repeat(100) }) }).fetch,
        maxBytes: 50,
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses an answer that is neither a credential nor a compact JWS, and a service that is not HTTPS", async () => {
    for (const body of ["hello", "{ not json", `{"a":${"[".repeat(100)}${"]".repeat(100)}}`]) {
      await expect(
        refreshCredential(withService(), { fetch: serve({ [SERVICE]: body }).fetch }),
        body,
      ).rejects.toBeInstanceOf(DataError);
    }
    await expect(
      refreshCredential(credentialWith({ id: "http://example.edu/refresh", type: "1EdTechCredentialRefresh" }), {
        fetch: serve({}).fetch,
      }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      refreshCredential(credentialWith({ id: 5, type: "1EdTechCredentialRefresh" }), { fetch: serve({}).fetch }),
    ).rejects.toBeInstanceOf(DataError);
  });

  it("refuses an answer with more tokens of JSON than maxTokens before it parses it", async () => {
    const hostile = serve({ [SERVICE]: `{"a":${HOSTILE}}` }).fetch;
    const error = await neverParsesLarge(() =>
      refreshCredential(withService(), { fetch: hostile, maxBytes: 2_000_000 }).catch((reason: unknown) => reason),
    );
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain("more than the 1000000 tokens");
    const small = refreshCredential(withService(), {
      fetch: serve({ [SERVICE]: '{"a":[1,2,3]}' }).fetch,
      maxTokens: 5,
    });
    await expect(small).rejects.toThrow("more than the 5 tokens");
  });

  it("ends with the reason of the signal, and refuses arguments of the wrong type", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      refreshCredential(withService(), { fetch: serve({}).fetch, signal: controller.signal }),
    ).rejects.toThrow("stop");
    const { fetch } = serve({});
    await expect(refreshCredential(JSON.parse("null"), { fetch })).rejects.toBeInstanceOf(DataError);
    await expect(refreshCredential(withService(), JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    for (const extra of [{ timeoutMs: 0 }, { maxBytes: 1.5 }, { maxTokens: 0 }, { signal: 1 }, { fetch: 5 }]) {
      await expect(
        refreshCredential(withService(), { fetch, ...JSON.parse(JSON.stringify(extra)) }),
      ).rejects.toBeInstanceOf(DataError);
    }
  });
});

describe("answering a request to refresh", () => {
  const request = (url: string, method = "GET") => ({ method, url, headers: {}, body: new Uint8Array(0) });
  const answering = (value: unknown) => ({ refresh: async () => value as never });

  it("gives the credential as JSON, or the compact JWS, for the identifier at the end of the path", async () => {
    const seen: string[] = [];
    const refresh = async (id: string) => {
      seen.push(id);
      return { id };
    };
    const json = await handleRefreshRequest(request("https://issuer.example/refresh/credentials%2F3732?x=1"), {
      refresh,
    });
    expect(seen).toStrictEqual(["credentials/3732"]);
    expect(json).toMatchObject({ status: 200, body: '{"id":"credentials/3732"}' });
    expect(json.headers["content-type"]).toContain("application/json");
    expect(await handleRefreshRequest(request("https://issuer.example/refresh/3732"), answering(JWS))).toStrictEqual({
      status: 200,
      headers: { "content-type": "application/jwt" },
      body: JWS,
    });
  });

  it("answers 404 for a credential that the port does not know, and 500 with nothing of the cause when it rejects", async () => {
    expect(await handleRefreshRequest(request("https://issuer.example/refresh/1"), answering(undefined))).toMatchObject(
      { status: 404, body: "" },
    );
    const failing = { refresh: async () => Promise.reject(new Error("secret database detail")) };
    expect(await handleRefreshRequest(request("https://issuer.example/refresh/1"), failing)).toStrictEqual({
      status: 500,
      headers: {},
      body: "",
    });
  });

  it("answers 405 with Allow for another method, and 400 for a path with no identifier", async () => {
    expect(
      await handleRefreshRequest(request("https://issuer.example/refresh/1", "POST"), answering(JWS)),
    ).toStrictEqual({ status: 405, headers: { allow: "GET" }, body: "" });
    expect(await handleRefreshRequest(request("https://issuer.example/"), answering(JWS))).toMatchObject({
      status: 400,
    });
    expect(
      await handleRefreshRequest(request("https://issuer.example/refresh/%E0%A4%A"), answering(JWS)),
    ).toMatchObject({ status: 400 });
  });

  it("passes the abort of the caller and refuses a port that answers something else", async () => {
    const controller = new AbortController();
    const aborting = {
      signal: controller.signal,
      refresh: async () => {
        controller.abort(new Error("stop"));
        throw new Error("late");
      },
    };
    await expect(handleRefreshRequest(request("https://issuer.example/refresh/1"), aborting)).rejects.toThrow("stop");
    controller.abort(new Error("stop"));
    await expect(
      handleRefreshRequest(request("https://issuer.example/refresh/1"), {
        signal: controller.signal,
        refresh: async () => undefined,
      }),
    ).rejects.toThrow("stop");
    await expect(
      handleRefreshRequest(request("https://issuer.example/refresh/1"), answering(5)),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      handleRefreshRequest(request("https://issuer.example/refresh/1"), answering(null)),
    ).rejects.toBeInstanceOf(DataError);
  });

  it("refuses a request and options of the wrong type", async () => {
    await expect(handleRefreshRequest(JSON.parse("null"), answering(JWS))).rejects.toBeInstanceOf(DataError);
    await expect(
      handleRefreshRequest(request("https://issuer.example/refresh/1"), JSON.parse("null")),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      handleRefreshRequest(request("https://issuer.example/refresh/1"), JSON.parse('{"refresh":5}')),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      handleRefreshRequest(request("https://issuer.example/refresh/1"), {
        refresh: async () => JWS,
        ...JSON.parse('{"signal":1}'),
      }),
    ).rejects.toBeInstanceOf(DataError);
  });
});
