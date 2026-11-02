import { describe, expect, it } from "vitest";
import { createKeyedCache, DataError } from "../src/index.js";

/** A clock that tells a time the test sets. */
function clockAt(start: number) {
  let time = start;
  return {
    now: () => time,
    set(value: number) {
      time = value;
    },
  };
}

/** A promise and the means to settle it from outside. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const cacheOf = (clock = clockAt(0), maxEntries = 3) =>
  createKeyedCache<number>({ clock, lifetime: (value) => value * 1000, maxEntries });

describe("a cache of values by key", () => {
  it("keeps a value for the lifetime that the value gives", async () => {
    const clock = clockAt(0);
    const cache = cacheOf(clock);
    let loads = 0;
    const load = async () => {
      loads += 1;
      return 10;
    };
    expect(await cache.get("a", load)).toBe(10);
    clock.set(9_999);
    await cache.get("a", load);
    expect(loads).toBe(1);
    clock.set(10_000);
    await cache.get("a", load);
    expect(loads).toBe(2);
  });

  it("does not keep a value whose lifetime is zero or less", async () => {
    const cache = cacheOf();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return 0;
    };
    await cache.get("a", load);
    await cache.get("a", load);
    expect(loads).toBe(2);
  });

  it("drops the oldest key when it holds more than its limit", async () => {
    const cache = cacheOf();
    const loads: string[] = [];
    const loadAs = (key: string) => async () => {
      loads.push(key);
      return 10;
    };
    for (const key of ["a", "b", "c", "d"]) await cache.get(key, loadAs(key));
    for (const key of ["b", "c", "d"]) await cache.get(key, loadAs(key));
    expect(loads).toStrictEqual(["a", "b", "c", "d"]);
    await cache.get("a", loadAs("a"));
    expect(loads).toStrictEqual(["a", "b", "c", "d", "a"]);
  });

  it("loads again when the kept value is as old as the caller allows, although it is good", async () => {
    const clock = clockAt(0);
    const cache = cacheOf(clock);
    let loads = 0;
    const load = async () => {
      loads += 1;
      return 100;
    };
    await cache.get("a", load);
    clock.set(59_999);
    await cache.get("a", load, undefined, 60_000);
    expect(loads).toBe(1);
    clock.set(60_000);
    await cache.get("a", load, undefined, 60_000);
    expect(loads).toBe(2);
  });

  it("shares one load between the callers that ask while it runs, and does not keep a failed one", async () => {
    const cache = cacheOf();
    const pending = deferred<number>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return pending.promise;
    };
    const first = cache.get("a", load);
    const second = cache.get("a", load);
    pending.reject(new Error("down"));
    await expect(first).rejects.toThrow("down");
    await expect(second).rejects.toThrow("down");
    expect(loads).toBe(1);
    expect(await cache.get("a", async () => 5)).toBe(5);
  });

  it("ends the wait of the caller that aborts and no other", async () => {
    const cache = cacheOf();
    const pending = deferred<number>();
    const controller = new AbortController();
    const aborted = cache.get("a", () => pending.promise, { signal: controller.signal });
    const patient = cache.get("a", () => pending.promise);
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
    pending.resolve(7);
    expect(await patient).toBe(7);
  });

  it("refuses a caller whose signal has aborted before it asks", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(cacheOf().get("a", async () => 1, { signal: controller.signal })).rejects.toThrow("stop");
  });

  it("refuses a signal that is not one", async () => {
    await expect(cacheOf().get("a", async () => 1, JSON.parse('{"signal":"x"}'))).rejects.toThrow("signal");
  });
});

describe("the options of a cache", () => {
  it.each([
    ["no options", JSON.parse("null")],
    ["a clock that is no clock", { clock: "now", lifetime: () => 1, maxEntries: 1 }],
    ["a lifetime that is no function", { clock: clockAt(0), lifetime: 5, maxEntries: 1 }],
    ["no room", { clock: clockAt(0), lifetime: () => 1, maxEntries: 0 }],
  ])("are refused with %s", (_name, options) => {
    expect(() => createKeyedCache(options)).toThrow(DataError);
  });
});
