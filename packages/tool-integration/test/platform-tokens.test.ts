import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { ltiPlatformLogin, platformStorage } from "../src/platform/index.js";
import {
  openAccess,
  openHint,
  openLineItem,
  openLoginHint,
  sealAccess,
  sealHint,
  sealLineItem,
  sealLoginHint,
  sealToken,
} from "../src/platform/internal.js";
import { toolRegistration } from "./fake-tool.js";
import { generateKeyPair } from "./fixture.js";
import { baseLaunch, config, hintKey, setup } from "./platform-setup.js";

const hint = {
  resource: "session-1/q1/1",
  principal: "candidate-7",
  client: "tool-1",
  target: "https://tool.example/launch",
  custom: { exam: "t1" },
  title: "Drawing tool",
  scoreMaximum: 10,
  jti: "jti-1",
  exp: 1_700_000_300,
};
const lineItem = { resource: "r", client: "tool-1", subject: "candidate-7", title: "Drawing tool", scoreMaximum: 10 };
const access = { client: "tool-1", scopes: ["a", "b"], exp: 1_700_003_600 };

describe("sealed claims", () => {
  it("come back as they were sealed, for each use", async () => {
    expect(await openHint(await sealHint(hint, hintKey), hintKey)).toEqual(hint);
    expect(await openLineItem(await sealLineItem(lineItem, hintKey), hintKey)).toEqual(lineItem);
    expect(await openAccess(await sealAccess(access, hintKey), hintKey)).toEqual(access);
    expect(await openLoginHint(await sealLoginHint("candidate-7", hintKey), hintKey)).toBe("candidate-7");
  });

  it("are refused when they were sealed for the use but do not have the shape of it", async () => {
    await expect(openHint(await sealToken("hint", { resource: "r" }, hintKey), hintKey)).rejects.toMatchObject({
      reason: "hint-invalid",
      status: 403,
    });
    await expect(openHint("not-a-token", hintKey)).rejects.toMatchObject({ reason: "hint-invalid" });
    expect(await openLineItem(await sealToken("line-item", { resource: "r" }, hintKey), hintKey)).toBeUndefined();
    expect(await openAccess(await sealToken("access", { client: 1 }, hintKey), hintKey)).toBeUndefined();
    expect(await openLoginHint(await sealToken("login", { principal: 5 }, hintKey), hintKey)).toBeUndefined();
  });

  it("are refused for another use, even with the right shape", async () => {
    expect(await openAccess(await sealToken("line-item", { ...access }, hintKey), hintKey)).toBeUndefined();
    expect(await openLineItem(await sealToken("access", { ...lineItem }, hintKey), hintKey)).toBeUndefined();
  });
});

describe("a registration that is not valid", () => {
  it("is refused for a deployment of more than 255 characters and for keys that are not a Map of public keys", async () => {
    const ctx = setup();
    const login = (registration: unknown) =>
      ltiPlatformLogin(baseLaunch, { ...ctx.login, registration: async () => registration as never });
    await expect(login({ ...toolRegistration(), deploymentId: "d".repeat(256) })).rejects.toThrow(
      "The deployment of a tool must have at most 255 characters",
    );
    const keys = { ...toolRegistration(), jwksUrl: undefined, keys: { kid: "not a map" } };
    await expect(login(keys)).rejects.toThrow("The keys of a tool must be a Map of public RSASSA-PKCS1-v1_5 keys");
    const weak = await generateKeyPair("weak", 1024);
    const small = { ...toolRegistration(), jwksUrl: undefined, keys: new Map([[weak.kid, weak.publicKey]]) };
    await expect(login(small)).rejects.toThrow("with SHA-256 of at least 2048 bits by kid");
  });
});

describe("platformStorage", () => {
  it("refuses a name of the tool's frame that is empty", () => {
    expect(() => platformStorage({ config, clock: { now: () => 1 }, toolFrame: "" })).toThrow(
      new DataError('The option toolFrame must be a non-empty string, found "".'),
    );
  });
});
