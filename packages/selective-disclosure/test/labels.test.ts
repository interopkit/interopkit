import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacLabelMap } from "../src/document/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const CANONICAL = new Map([
  ["b0", "c14n0"],
  ["b1", "c14n1"],
]);

describe("the labels that the HMAC gives blank nodes", () => {
  it("are u and the base64url of the HMAC-SHA256 of each canonical label, by the key", async () => {
    const labels = await (await hmacLabelMap(KEY))({ canonicalIdMap: CANONICAL });
    const expected = (label: string) => `u${createHmac("sha256", KEY).update(label).digest("base64url")}`;
    expect(labels).toStrictEqual(
      new Map([
        ["b0", expected("c14n0")],
        ["b1", expected("c14n1")],
      ]),
    );
  });

  it("are made with Web Crypto, and not with node:crypto and the Buffer of Node.js, which a worker does not have", async () => {
    const sign = vi.spyOn(crypto.subtle, "sign");
    await (await hmacLabelMap(KEY))({ canonicalIdMap: CANONICAL });
    expect(sign.mock.calls.map(([algorithm]) => algorithm)).toStrictEqual(["HMAC", "HMAC"]);
  });
});
