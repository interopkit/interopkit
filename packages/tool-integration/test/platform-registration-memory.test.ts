import { createCryptoKeySigner } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { generateKeyPair, request } from "./fixture.js";
import { config, handle, PLATFORM_ORIGIN, setup } from "./platform-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the requests may raise the peak of the process by. */
const BUDGET = 32 * MIB;
/** The most bytes of the body of a request to the platform by default. */
const MAX_BODY_BYTES = 65_536;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one handler.
describe("the peak memory of the bodies of the registration endpoint", () => {
  it("stays within the budget for registrations of 64 KiB of nesting and of arrays", async ({ annotate }) => {
    const ctx = setup();
    const key = await generateKeyPair("platform-rsa-1");
    const registering = {
      config: {
        ...config,
        issuer: PLATFORM_ORIGIN,
        keys: {
          signer: createCryptoKeySigner(key.privateKey, { algorithm: "RS256", keyId: key.kid }),
          publicKeys: [key.publicJwk],
        },
        instance: { guid: "platform-1", productFamilyCode: "tests" },
      },
      openRegistration: true,
      services: {
        registrations: {
          register: async () => ({ reason: "invalid_client_metadata" as const, message: "No." }),
          get: async () => undefined,
          update: async () => undefined,
        },
      },
    };
    const nesting = `${"[".repeat(MAX_BODY_BYTES / 2)}${"]".repeat(MAX_BODY_BYTES / 2)}`;
    const array = `[${"0,".repeat(MAX_BODY_BYTES / 2 - 2)}0]`;
    const posts = [nesting, array].map((body) =>
      request({
        url: `${PLATFORM_ORIGIN}/registration`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    const before = peak();
    for (const post of posts) expect((await handle(ctx, post, registering)).status).toBe(400);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
