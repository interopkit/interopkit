import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_RANDOM } from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

/** Makes `crypto.getRandomValues` fill the array with the given words. */
function words(first: number, second: number): void {
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => {
    array.set([first, second]);
    return array;
  }) as typeof crypto.getRandomValues);
}

describe("SYSTEM_RANDOM", () => {
  it("is an object with a uniform method, as the random sources of the other libraries are", () => {
    expect(typeof SYSTEM_RANDOM.uniform).toBe("function");
    expect(Object.keys(SYSTEM_RANDOM)).toStrictEqual(["uniform"]);
  });

  it("draws 0 from words of zeros, and the largest draw below 1 from words of ones", () => {
    words(0, 0);
    expect(SYSTEM_RANDOM.uniform()).toBe(0);
    words(0xffff_ffff, 0xffff_ffff);
    expect(SYSTEM_RANDOM.uniform()).toBe(1 - 2 ** -53);
  });

  it("uses the high bits of each word, so that a draw is uniform", () => {
    words(0x8000_0000, 0);
    expect(SYSTEM_RANDOM.uniform()).toBe(0.5);
    words(0, 0x8000_0000);
    expect(SYSTEM_RANDOM.uniform()).toBe(2 ** -28);
    words(0x4000_0000, 0x4000_0000);
    expect(SYSTEM_RANDOM.uniform()).toBe(0.25 + 2 ** -29);
  });

  it("draws values in [0, 1) that are multiples of 2 to the power of -53", () => {
    for (let draw = 0; draw < 2000; draw += 1) {
      const value = SYSTEM_RANDOM.uniform();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Number.isInteger(value * 2 ** 53)).toBe(true);
    }
  });

  it("draws values that spread over the interval", () => {
    const draws = Array.from({ length: 10_000 }, () => SYSTEM_RANDOM.uniform());
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    // The standard deviation of this mean is 0.003, so a tolerance of 0.02 holds for any run that is not broken.
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
    const tenths = new Array<number>(10).fill(0);
    for (const value of draws) tenths[Math.floor(value * 10)] = (tenths[Math.floor(value * 10)] ?? 0) + 1;
    for (const count of tenths) expect(count).toBeGreaterThan(800);
  });
});
