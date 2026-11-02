import { DataError, signerFromCryptoKey } from "@interopkit/core";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { deepLinkResponse, ltiLaunch } from "../src/tool/index.js";
import { CLIENT_ID, ISSUER } from "./fake-platform.js";
import { NOW, readToken } from "./fixture.js";
import { cookieLogin, deepLinkingOf, setup } from "./tool-setup.js";

describe("a line item of a Deep Linking item", () => {
  async function launchOf() {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    return { ctx, launch: deepLinkingOf(await ltiLaunch(post, ctx.options)) };
  }

  it("is accepted by the platform: issued by the client, for the platform, signed with the key of the registration", async () => {
    const { ctx, launch } = await launchOf();
    const jwt = await deepLinkResponse(launch, [{ title: "Exam" }], ctx.options);
    const claims = await ctx.platform.acceptDeepLinking(jwt, launch.settings.data);
    expect(claims).toMatchObject({ iss: ctx.registration.clientId, aud: ctx.registration.issuer });
  });

  it("carries its label, resource identifier and tag into the signed content item", async () => {
    const { ctx, launch } = await launchOf();
    const lineItem = { scoreMaximum: 100, label: "Exam", resourceId: "exam-1", tag: "final" };
    const jwt = await deepLinkResponse(launch, [{ title: "Exam", lineItem }], ctx.options);
    expect(readToken(jwt).payload["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toEqual([
      { type: "ltiResourceLink", title: "Exam", lineItem },
    ]);
  });

  it("is refused when its label is not text", async () => {
    const { ctx, launch } = await launchOf();
    const lineItem = JSON.parse('{"scoreMaximum": 100, "label": 5}');
    await expect(deepLinkResponse(launch, [{ lineItem }], ctx.options)).rejects.toStrictEqual(
      new DataError("The label of a line item must be a string, found 5."),
    );
  });
});

describe("the signature of a Deep Linking response", () => {
  it("is the signer's, with its algorithm and its key id, such as ES256 with a key that a KMS holds", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const ctx = setup({ signer: signerFromCryptoKey(pair.privateKey, { algorithm: "ES384", keyId: "tool-ec-2" }) });
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    const launch = deepLinkingOf(await ltiLaunch(post, ctx.options));
    const jwt = await deepLinkResponse(launch, [{ title: "Exam" }], ctx.options);
    const { payload, protectedHeader } = await jwtVerify(jwt, pair.publicKey, {
      issuer: CLIENT_ID,
      audience: ISSUER,
      currentDate: new Date(NOW),
    });
    expect(protectedHeader).toStrictEqual({ alg: "ES384", kid: "tool-ec-2", typ: "JWT" });
    expect(payload["https://purl.imsglobal.org/spec/lti/claim/message_type"]).toBe("LtiDeepLinkingResponse");
  });

  it("rejects with the error of the signer, and the reason of the signal", async () => {
    const down = new Error("The KMS is down.");
    const ctx = setup({ signer: { algorithm: "RS256", keyId: "tool-1", sign: () => Promise.reject(down) } });
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    const launch = deepLinkingOf(await ltiLaunch(post, ctx.options));
    await expect(deepLinkResponse(launch, [], ctx.options)).rejects.toBe(down);
    const reason = new Error("The user left.");
    await expect(deepLinkResponse(launch, [], { ...ctx.options, signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });
});
