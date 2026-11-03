import { describe, expect, it } from "vitest";
import { callPort } from "../src/index.js";

describe("callPort", () => {
  it("returns the value of a port in an object, whether it answers at once or later", async () => {
    expect(await callPort(() => 5)).toStrictEqual({ value: 5 });
    expect(await callPort(async () => "later")).toStrictEqual({ value: "later" });
    expect(await callPort(() => undefined)).toStrictEqual({ value: undefined });
  });

  it("returns undefined when the port rejects or throws, whatever it throws", async () => {
    expect(await callPort(() => Promise.reject(new Error("down")))).toBeUndefined();
    expect(
      await callPort(() => {
        throw new Error("down");
      }),
    ).toBeUndefined();
    expect(await callPort(() => Promise.reject("text"))).toBeUndefined();
  });

  it("returns the value while the signal has not aborted", async () => {
    const controller = new AbortController();
    expect(await callPort(async () => 1, { signal: controller.signal })).toStrictEqual({ value: 1 });
  });

  it("rejects with the reason of the signal when it aborts during the call, and leaves the port running", async () => {
    const controller = new AbortController();
    const reason = new Error("gave up");
    const waiting = callPort(() => new Promise<never>(() => undefined), { signal: controller.signal });
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
  });

  it("rejects with the reason of a signal that aborted, and does not call the port", async () => {
    const reason = new Error("before");
    let calls = 0;
    await expect(
      callPort(
        () => {
          calls += 1;
          return 1;
        },
        { signal: AbortSignal.abort(reason) },
      ),
    ).rejects.toBe(reason);
    expect(calls).toBe(0);
  });

  it("rejects with the reason of the signal when the port fails after the signal aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("aborted first");
    const waiting = callPort(
      async () => {
        controller.abort(reason);
        throw new Error("the port failed");
      },
      { signal: controller.signal },
    );
    await expect(waiting).rejects.toBe(reason);
  });
});
