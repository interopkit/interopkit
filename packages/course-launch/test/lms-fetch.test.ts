import { describe, expect, it } from "vitest";
import { readLaunchUrl } from "../src/index.js";
import { prepareLaunch } from "../src/lms/index.js";
import { AU1, ORIGIN, testHost } from "./lms-host.js";
import { jsonOf, postFetch, register } from "./lms-session.js";

/** Launches the first unit and returns its fetch URL. */
async function fetchUrlOf(
  host: ReturnType<typeof testHost>,
): Promise<{ readonly url: string; readonly session: string }> {
  const registration = await register(host);
  const launch = await prepareLaunch({ registration: registration.id, au: AU1 }, host.options);
  return { url: readLaunchUrl(launch.url).fetch, session: launch.session };
}

describe("the fetch URL", () => {
  it("answers the first POST with the token of the session, as JSON that no cache keeps", async () => {
    const host = testHost();
    const { url, session } = await fetchUrlOf(host);
    const answer = await postFetch(host, url);
    expect(answer.status).toBe(200);
    expect(answer.headers).toMatchObject({
      "content-type": expect.stringMatching(/^application\/json/),
      "cache-control": "no-store",
    });
    const token = (jsonOf(answer) as { "auth-token": string })["auth-token"];
    expect(atob(token).split(":")[0]).toBe(session);
    expect((await host.store.session(session))?.state).toBe("active");
  });

  it("answers a second POST with error code 1 and no token", async () => {
    const host = testHost();
    const { url } = await fetchUrlOf(host);
    await postFetch(host, url);
    const again = await postFetch(host, url);
    expect(again.status).toBe(200);
    expect(jsonOf(again)).toStrictEqual({
      "error-code": "1",
      "error-text": "The authorization token has already been returned, or the launch expired.",
    });
  });

  it("gives one token to two POSTs at once", async () => {
    const host = testHost();
    const { url } = await fetchUrlOf(host);
    const answers = await Promise.all([postFetch(host, url), postFetch(host, url)]);
    const tokens = answers
      .map((answer) => jsonOf(answer) as Record<string, string>)
      .filter((body) => "auth-token" in body);
    expect(tokens).toHaveLength(1);
  });

  it("answers error code 1 after the lifetime of the fetch URL", async () => {
    const host = testHost({ fetchLifetimeSeconds: 10 });
    const { url } = await fetchUrlOf(host);
    host.clock.advance(10_001);
    expect(jsonOf(await postFetch(host, url))).toMatchObject({ "error-code": "1" });
  });

  it("answers error code 2 for a code that the LMS did not make", async () => {
    const host = testHost();
    const { url, session } = await fetchUrlOf(host);
    for (const code of [`${session}.wrong`, session, `${session}.`, "not-a-uuid.secret", ""]) {
      const forged = new URL(url);
      forged.searchParams.set("code", code);
      expect(jsonOf(await postFetch(host, forged.href)), code).toMatchObject({ "error-code": "2" });
    }
    expect(jsonOf(await postFetch(host, `${ORIGIN}/fetch`))).toMatchObject({ "error-code": "2" });
    const unknown = new URL(url);
    unknown.searchParams.set(
      "code",
      `11111111-1111-4111-8111-111111111111.${new URL(url).searchParams.get("code")?.split(".")[1]}`,
    );
    expect(jsonOf(await postFetch(host, unknown.href))).toMatchObject({ "error-code": "2" });
    const twice = new URL(url);
    twice.searchParams.append("code", "other");
    expect(jsonOf(await postFetch(host, twice.href))).toMatchObject({ "error-code": "2" });
  });

  it("answers error code 3 when the store fails or keeps a conflict", async () => {
    const host = testHost();
    const { url } = await fetchUrlOf(host);
    host.store.failing.add("session");
    expect(jsonOf(await postFetch(host, url))).toMatchObject({ "error-code": "3" });
    host.store.failing.clear();
    host.store.conflicts.session = 10;
    expect(jsonOf(await postFetch(host, url))).toMatchObject({ "error-code": "3" });
    host.store.conflicts.session = 0;
    expect(jsonOf(await postFetch(host, url))).toHaveProperty("auth-token");
  });

  it("answers another method with 405 and Allow", async () => {
    const host = testHost();
    const { url } = await fetchUrlOf(host);
    expect(await postFetch(host, url, "GET")).toStrictEqual({
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
      body: "",
    });
  });

  it("rejects with the reason of the signal when it aborts", async () => {
    const host = testHost();
    const { url } = await fetchUrlOf(host);
    const controller = new AbortController();
    controller.abort(new Error("Stopped."));
    const { handleFetchRequest } = await import("../src/lms/index.js");
    await expect(
      handleFetchRequest(
        { method: "POST", url, headers: {}, body: new Uint8Array() },
        { ...host.options, signal: controller.signal },
      ),
    ).rejects.toThrow("Stopped.");
  });
});
