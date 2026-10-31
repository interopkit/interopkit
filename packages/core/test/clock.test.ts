import { describe, expect, it } from "vitest";
import { checkClock, DataError, readClock, SYSTEM_CLOCK } from "../src/index.js";

describe("SYSTEM_CLOCK", () => {
  it("answers with the whole milliseconds of the system time", () => {
    const before = Date.now();
    const now = readClock(SYSTEM_CLOCK);
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("checkClock", () => {
  it("accepts an object with a function now, a class instance included", () => {
    class Fixed {
      now(): number {
        return 1_000;
      }
    }
    expect(() => checkClock({ now: () => 1 })).not.toThrow();
    expect(() => checkClock(new Fixed())).not.toThrow();
    expect(() => checkClock(SYSTEM_CLOCK)).not.toThrow();
  });

  it("refuses a value that is not an object with a function now", () => {
    expect(() => checkClock(JSON.parse("null"))).toThrow(
      new DataError("The option clock must be an object, found null."),
    );
    expect(() => checkClock(JSON.parse('{"now": 5}'))).toThrow(
      new DataError("The function now of the option clock must be a function, found 5."),
    );
  });
});

describe("readClock", () => {
  it("returns the time of the clock", () => {
    expect(readClock({ now: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
    expect(readClock({ now: () => 0 })).toBe(0);
  });

  it("refuses an answer that is not a non-negative integer", () => {
    for (const answer of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(() => readClock({ now: () => answer as never })).toThrow(DataError);
    }
    expect(() => readClock({ now: () => 1.5 })).toThrow(
      "The time of the clock must be a non-negative integer, found 1.5.",
    );
  });
});
