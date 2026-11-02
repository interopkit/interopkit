import { createKeyedCache } from "@interopkit/core";
import { expect, test } from "vitest";
import { alternate, expectRatioWithin } from "./budgets.js";

/** The keys that the cache holds, as a verifier holds the key sets and status lists of the issuers it meets. */
const KEYS = 1000;
/** The callers that ask for one key while it loads, as the requests that a burst sends to one issuer. */
const CALLERS = 100;
const clock = { now: () => 0 };
const keys = Array.from({ length: KEYS }, (_, index) => `https://issuer${index}.example/keys`);

test("answers from a cache of 1,000 keys near a Map, and shares a load among 100 callers", async ({
  annotate,
  bench,
}) => {
  const cache = createKeyedCache<object>({ clock, lifetime: () => 60_000, maxEntries: KEYS });
  const map = new Map<string, { readonly value: object; readonly expiresAt: number }>();
  for (const key of keys) {
    const value = { key };
    await cache.get(key, async () => value);
    map.set(key, { value, expiresAt: 60_000 });
  }
  const fromMap = async (key: string) => {
    const entry = map.get(key);
    return entry !== undefined && clock.now() < entry.expiresAt ? entry.value : undefined;
  };
  const unused = async () => ({});
  expect(await cache.get(keys[1] ?? "", unused)).toStrictEqual({ key: keys[1] });
  const hits = await alternate(
    bench,
    "KeyedCache.get of each kept key",
    () => Promise.all(keys.map((key) => cache.get(key, unused))),
    { name: "a Map with an expiry", run: () => Promise.all(keys.map(fromMap)) },
  );
  await expectRatioWithin(annotate, "keyedCacheHit", "a Map with an expiry", hits);

  // A load that settles after the callers of the burst have asked, as a fetch does.
  const load = () => new Promise<object>((resolve) => setImmediate(() => resolve({})));
  const fresh = createKeyedCache<object>({ clock, lifetime: () => 0, maxEntries: 1 });
  const burst = () => Promise.all(Array.from({ length: CALLERS }, () => fresh.get("key", load)));
  const alone = async () => {
    const shared = load();
    return await Promise.all(Array.from({ length: CALLERS }, () => shared));
  };
  const sharing = await alternate(bench, "KeyedCache.get of 100 callers of one load", burst, {
    name: "100 waits on one promise",
    run: alone,
  });
  await expectRatioWithin(annotate, "keyedCacheShared", "100 waits on one promise", sharing);
});
