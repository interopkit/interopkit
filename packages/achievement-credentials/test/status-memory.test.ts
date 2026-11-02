import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { signCredentialJwt } from "../src/jwt/index.js";
import { verifyCredentialStatus } from "../src/status/index.js";
import { credentialWithStatus, ISSUER, LIST_URL, METHOD, signer, world } from "./status-fixtures.js";

const MIB = 1024 * 1024;
/** The bytes that one check may raise the peak of the process by: the limit of what a list inflates to, and its chunks. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one check.
describe("the peak memory of the check of a hostile status list", () => {
  it("stays within the budget for a list within the fetch limit that inflates to 256 MiB", async () => {
    const zeros = new Uint8Array(256 * MIB);
    const compressed = new Uint8Array(
      await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
    );
    const bomb = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      id: LIST_URL,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: ISSUER,
      validFrom: "2024-06-14T00:00:00Z",
      credentialSubject: {
        id: `${LIST_URL}#list`,
        type: "BitstringStatusList",
        statusPurpose: "revocation",
        encodedList: `u${base64url.encode(compressed)}`,
      },
    };
    const { options } = world({ [LIST_URL]: await signCredentialJwt(bomb as never, signer, { kid: METHOD }) });
    const before = peak();
    const result = await verifyCredentialStatus(credentialWithStatus(), options);
    const grown = peak() - before;
    expect(result).toMatchObject({ outcome: "failed", detail: expect.stringContaining("inflates to more than") });
    expect(grown).toBeLessThan(BUDGET);
  });
});
