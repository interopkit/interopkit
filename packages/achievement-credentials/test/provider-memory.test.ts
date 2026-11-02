import { describe, expect, it } from "vitest";
import { handleCredentialsRequest } from "../src/provider/index.js";
import { achievementCredential } from "./fixtures.js";
import { ORIGIN, ROOTS, serving } from "./provider-fixture.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one request may raise the peak of the process by. Bounded by the tokens, the body below takes about 120 MiB;
 * the memory grows with the objects, so ten times the body, which the limits refuse, would take about ten times as much.
 */
const BUDGET = 256 * MIB;
/** The body of the default limit, `maxBodyBytes`. */
const LIMIT = MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** The most tokens of JSON in a body, `maxTokens`. */
const TOKENS = 1_000_000;
/** The tokens of an empty object in a list: its two braces and a comma. */
const TOKENS_PER_OBJECT = 3;

/**
 * A credential whose `evidence` holds as many empty objects as the default limits of a body leave room for: the tokens bound them
 * before the bytes do, and each is an error of the reader.
 */
function crowded(): string {
  const shell = JSON.stringify({ ...achievementCredential(), evidence: [] });
  const count = Math.floor((TOKENS - shell.length) / TOKENS_PER_OBJECT);
  const evidence = new Array(count).fill("{}").join(",");
  return shell.replace('"evidence":[]', `"evidence":[${evidence}]`);
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one request.
describe("the peak memory of an upsert of a hostile credential", () => {
  it("stays within the budget for a body at the size limit that holds the most objects of JSON", async () => {
    const body = new TextEncoder().encode(crowded());
    expect(body.byteLength).toBeLessThanOrEqual(LIMIT);
    const { options } = serving();
    const before = peak();
    const response = await handleCredentialsRequest(
      {
        method: "POST",
        url: `${ORIGIN}${ROOTS.badges}/credentials`,
        headers: { "content-type": "application/json", authorization: "Bearer token-all" },
        body,
      },
      options,
    );
    const grown = peak() - before;
    expect(response.status).toBe(422);
    expect(grown).toBeLessThan(BUDGET);
  });
});
