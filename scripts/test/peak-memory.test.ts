import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../peak-memory.ts";
import type { READINGS } from "./fixtures/peak-memory-readings.ts";

const MIB = 1024 * 1024;

let bundle: Bundle;
beforeAll(async () => {
  bundle = await bundleReadings(`${import.meta.dirname}/fixtures/peak-memory-readings.ts`);
});
afterAll(() => removeBundle(bundle));

const read = (name: keyof typeof READINGS, heapMiB = 64) => readInProcess(bundle, name, heapMiB);

describe("the harness of the peak memory of a reading", () => {
  it("hands the input of a reading on as the same bytes", async () => {
    expect((await read("bytes")).outcome).toBe("Uint8Array of 3 bytes");
  });

  it("hands the input of a reading on as the same text", async () => {
    expect((await read("text")).outcome).toBe("1000 characters");
  });

  it("reports how far the reading raised the peak of the process", async () => {
    expect((await read("hungry", 512)).rise).toBeGreaterThan(MIB);
  });

  it("ends a reading that keeps more alive than its heap, and lets it end in a larger heap", async () => {
    await expect(read("hungry", 32)).rejects.toThrow("The reading hungry did not end within a heap of 32 MiB");
    expect((await read("hungry", 512)).outcome).toBe("16 lists");
  });

  it("reports what a reading threw", async () => {
    expect((await read("refused")).outcome).toBe("RangeError: Too long.");
  });

  it("gives the fakes of the tests an expect that passes what holds and refuses what does not", async () => {
    expect((await read("asserting")).outcome).toBe("ExpectationError: The fake expected two.");
  });

  it("names the rise of the peak in MiB", () => {
    expect(risen(5 * MIB)).toBe("The peak rose by 5.0 MiB.");
  });

  it("prints the least heap in which a reading of a package ends", () => {
    const run = spawnSync(process.execPath, [`${import.meta.dirname}/../peak-memory.ts`, "core", "formPluses"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/\| formPluses \| \d+ \| \d+ \| a value of 10485758 characters \|/u);
  });
});
