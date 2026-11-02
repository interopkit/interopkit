// biome-ignore-all lint/style/useNamingConvention: the names of a registration of Dynamic Registration are those of the specification.

import { describe, expect, it } from "vitest";
import { SCOPES } from "../src/index.js";
import { discoverPlatform, registerTool } from "../src/tool/index.js";

const MIB = 1024 * 1024;
/** The bytes that the readings may raise the peak of the process by: an answer of 1 MiB that the limit refuses is far less. */
const BUDGET = 32 * MIB;
/** The most bytes of an answer of a step of Dynamic Registration by default. */
const MAX_BYTES = 65_536;
const ISSUER = "https://lms.example.edu";
const CONFIGURATION_URL = `${ISSUER}/.well-known/openid-configuration`;
const TOOL = "https://tool.example.com";

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** The platform's configuration, which leads the tool to the registration endpoint. */
const CONFIGURATION = JSON.stringify({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  token_endpoint_auth_methods_supported: ["private_key_jwt"],
  token_endpoint_auth_signing_alg_values_supported: ["RS256"],
  jwks_uri: `${ISSUER}/jwks`,
  registration_endpoint: `${ISSUER}/register`,
  scopes_supported: ["openid", SCOPES.score],
  response_types_supported: ["id_token"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  claims_supported: ["iss", "sub"],
  "https://purl.imsglobal.org/spec/lti-platform-configuration": {
    product_family_code: "lms",
    messages_supported: [{ type: "LtiResourceLinkRequest" }],
  },
});

/** The platform's answer to the registration, whose `redirect_uris` is an array of the given length. */
function registered(uris: number): string {
  return JSON.stringify({
    client_id: "tool-2",
    application_type: "web",
    response_types: ["id_token"],
    grant_types: ["implicit", "client_credentials"],
    initiate_login_uri: `${TOOL}/login`,
    redirect_uris: Array.from({ length: uris }, () => `${TOOL}/l`),
    client_name: "Tool",
    jwks_uri: `${TOOL}/jwks`,
    token_endpoint_auth_method: "private_key_jwt",
    "https://purl.imsglobal.org/spec/lti-tool-configuration": {
      domain: "tool.example.com",
      target_link_uri: `${TOOL}/launch`,
      claims: ["iss", "sub"],
      messages: [{ type: "LtiResourceLinkRequest" }],
    },
  });
}

/** The tool's configuration. */
const TOOL_CONFIGURATION = {
  initiateLoginUri: `${TOOL}/login`,
  redirectUris: [`${TOOL}/l`],
  clientName: "Tool",
  jwksUri: `${TOOL}/jwks`,
  lti: {
    domain: "tool.example.com",
    targetLinkUri: `${TOOL}/launch`,
    messages: [{ type: "LtiResourceLinkRequest" }],
    claims: ["iss", "sub"],
  },
};

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one step.
describe("the peak memory of registerTool", () => {
  it("stays within the budget for a registration of an array just under the limit, and for one of 1 MiB", async ({
    annotate,
  }) => {
    const initiation = { openidConfiguration: CONFIGURATION_URL };
    let body = registered(2_200);
    const fetch = async (url: string) =>
      new Response(url === CONFIGURATION_URL ? CONFIGURATION : body, {
        headers: { "content-type": "application/json" },
      });
    const platform = await discoverPlatform(initiation, { fetch });
    expect(body.length).toBeGreaterThan(MAX_BYTES - 8192);
    expect(body.length).toBeLessThan(MAX_BYTES);
    const before = peak();
    await expect(registerTool(platform, TOOL_CONFIGURATION, initiation, { fetch })).resolves.toMatchObject({
      clientId: "tool-2",
    });
    body = registered(50_000);
    expect(body.length).toBeGreaterThan(MIB);
    await expect(registerTool(platform, TOOL_CONFIGURATION, initiation, { fetch })).rejects.toThrow("maxBytes");
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
