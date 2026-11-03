import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { startAuSession } from "../src/au/index.js";
import { launchFor } from "./au-host.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by: the launch data of 1 MiB, parsed once. */
const BUDGET = 64 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading launch data at their limit, with the most values they hold", () => {
  it("stays within the budget, and refuses launch data that cmi5 does not take", async ({ annotate }) => {
    const launch = await launchFor();
    const launchData = JSON.stringify({
      contextTemplate: { extensions: { "https://x.example.org/e": Array(250_000).fill(0) } },
    });
    expect(launchData.length).toBeLessThan(MIB);
    const before = peak();
    await expect(
      startAuSession(launch.url, {
        fetch: async (url, init) =>
          url.includes("stateId=LMS.LaunchData")
            ? new Response(launchData, {
                headers: {
                  "content-type": "application/json",
                  etag: '"1"',
                  "last-modified": "Thu, 15 Jan 2026 10:00:00 GMT",
                },
              })
            : launch.fetch(url, init),
      }),
    ).rejects.toThrow(DataError);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
