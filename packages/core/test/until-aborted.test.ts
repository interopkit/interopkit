import { describe, expect, it } from "vitest";
import { untilAborted } from "../src/index.js";

/** A promise and the means to settle it from outside. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("untilAborted", () => {
  it("returns the promise itself when there is no signal", () => {
    const promise = Promise.resolve(1);
    expect(untilAborted(promise)).toBe(promise);
  });

  it("settles with the promise while the signal has not aborted", async () => {
    const controller = new AbortController();
    await expect(untilAborted(Promise.resolve("done"), controller.signal)).resolves.toBe("done");
    await expect(untilAborted(Promise.reject(new Error("failed")), controller.signal)).rejects.toThrow("failed");
  });

  it("rejects with the reason of the signal as soon as it aborts, and leaves the promise running", async () => {
    const work = deferred<string>();
    const controller = new AbortController();
    const wait = untilAborted(work.promise, controller.signal);
    const reason = new Error("The caller left.");
    controller.abort(reason);
    await expect(wait).rejects.toBe(reason);
    work.resolve("late");
    await expect(work.promise).resolves.toBe("late");
  });

  it("rejects with the reason of a signal that aborted before the wait began", async () => {
    const reason = new Error("Already left.");
    await expect(untilAborted(new Promise<string>(() => undefined), AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it("ends only the wait of the caller whose signal aborts", async () => {
    const work = deferred<string>();
    const first = new AbortController();
    const ended = untilAborted(work.promise, first.signal);
    const waiting = untilAborted(work.promise, new AbortController().signal);
    first.abort();
    await expect(ended).rejects.toBeInstanceOf(DOMException);
    work.resolve("shared");
    await expect(waiting).resolves.toBe("shared");
  });

  it("reports no unhandled rejection when the promise fails after the wait ended", async () => {
    const work = deferred<string>();
    const controller = new AbortController();
    const wait = untilAborted(work.promise, controller.signal);
    controller.abort();
    await wait.catch(() => undefined);
    work.reject(new Error("The connection was reset."));
    // An unhandled rejection fails the run; the next turn of the event loop is where it would be reported.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("removes its listener from the signal when the promise settles", async () => {
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const { signal } = controller;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args: Parameters<typeof add>) => {
      added += 1;
      add(...args);
    };
    signal.removeEventListener = (...args: Parameters<typeof remove>) => {
      removed += 1;
      remove(...args);
    };
    await untilAborted(Promise.resolve(1), signal);
    await Promise.resolve();
    expect({ added, removed }).toStrictEqual({ added: 1, removed: 1 });
  });
});
