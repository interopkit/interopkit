import { ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { startAuSession } from "../src/au/index.js";
import { launchFor } from "./au-host.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by: an answer of the LRS at the limit of the runtime, 1 MiB, unparsed. */
const BUDGET = 16 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a preferences document of 1 MiB, over its limit of 4,096 bytes", () => {
  it("stays within the budget, and refuses the document without parsing it", async ({ annotate }) => {
    const launch = await launchFor();
    const preferences = `{"languagePreference":"en-US","audioPreference":"on","pad":"${"x".repeat(MIB - 100)}"}`;
    const before = peak();
    await expect(
      startAuSession(launch.url, {
        fetch: async (url, init) =>
          url.includes("profileId=cmi5LearnerPreferences")
            ? new Response(preferences, {
                headers: {
                  "content-type": "application/json",
                  etag: '"1"',
                  "last-modified": "Thu, 15 Jan 2026 10:00:00 GMT",
                },
              })
            : launch.fetch(url, init),
      }),
    ).rejects.toThrow(ServiceError);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
