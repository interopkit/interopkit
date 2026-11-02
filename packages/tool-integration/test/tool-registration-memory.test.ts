// biome-ignore-all lint/style/useNamingConvention: the names of the configuration of Dynamic Registration are those of the specification.

import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverPlatform } from "../src/tool/index.js";

const MIB = 1024 * 1024;
/** The bytes that the readings may raise the peak of the process by: an answer of 1 MiB that the limit refuses is far less. */
const BUDGET = 32 * MIB;
/** The most bytes of an answer of a step of Dynamic Registration by default. */
const MAX_BYTES = 65_536;
const ISSUER = "https://lms.example.edu";
const CONFIGURATION_URL = `${ISSUER}/.well-known/openid-configuration`;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

afterEach(() => vi.useRealTimers());

/** A configuration whose `claims_supported` is an array of the given length. */
function configuration(claims: number): string {
  return JSON.stringify({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth`,
    token_endpoint: `${ISSUER}/token`,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256"],
    jwks_uri: `${ISSUER}/jwks`,
    registration_endpoint: `${ISSUER}/register`,
    scopes_supported: ["openid"],
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: Array.from({ length: claims }, () => "a"),
    "https://purl.imsglobal.org/spec/lti-platform-configuration": {
      product_family_code: "lms",
      messages_supported: [],
    },
  });
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one step.
describe("the peak memory of discoverPlatform", () => {
  it("stays within the budget for a configuration of an array just under the limit, and for one of 1 MiB", async () => {
    let body = configuration(15_000);
    const fetch = async () => new Response(body, { headers: { "content-type": "application/json" } });
    expect(body.length).toBeGreaterThan(MAX_BYTES - 8192);
    expect(body.length).toBeLessThan(MAX_BYTES);
    const before = peak();
    await expect(discoverPlatform({ openidConfiguration: CONFIGURATION_URL }, { fetch })).resolves.toMatchObject({
      issuer: ISSUER,
    });
    body = configuration(270_000);
    expect(body.length).toBeGreaterThan(MIB);
    await expect(discoverPlatform({ openidConfiguration: CONFIGURATION_URL }, { fetch })).rejects.toThrow("maxBytes");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
