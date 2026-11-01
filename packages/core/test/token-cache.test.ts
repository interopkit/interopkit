import { describe, expect, it, vi } from "vitest";
import { type CallOptions, DataError } from "../src/index.js";
import { type AccessToken, createTokenCache } from "../src/oauth/index.js";
import { failureOf, NOW } from "./oauth-fixtures.js";

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

const token = (name: string, lifetimeSeconds?: number): AccessToken => ({
  accessToken: name,
  scopes: [],
  ...(lifetimeSeconds === undefined ? {} : { expiresAt: NOW + lifetimeSeconds * 1000 }),
});

/** A function that gives a token of the lifetime, named t1, t2 and so on. */
function issuing(lifetimeSeconds?: number): () => Promise<AccessToken> {
  let issued = 0;
  return async () => {
    issued += 1;
    return token(`t${issued}`, lifetimeSeconds);
  };
}

/** A clock that a test moves. */
function movingClock(): { readonly clock: { now(): number }; readonly set: (time: number) => void } {
  let time = NOW;
  return {
    clock: { now: () => time },
    set: (next) => {
      time = next;
    },
  };
}

describe("createTokenCache", () => {
  it("obtains a token once and gives it again while it is good", async () => {
    const obtain = vi.fn(async () => token("t1", 3600));
    const { clock } = movingClock();
    const current = createTokenCache(obtain, { clock });
    expect(await current()).toBe("t1");
    expect(await current()).toBe("t1");
    expect(await current()).toBe("t1");
    expect(obtain).toHaveBeenCalledTimes(1);
  });

  it("obtains a new token from the moment that the skew before the expiry begins, which is 60 seconds unless told otherwise", async () => {
    const obtain = vi.fn(issuing(3600));
    const { clock, set } = movingClock();
    const current = createTokenCache(obtain, { clock });
    expect(await current()).toBe("t1");
    set(NOW + (3600 - 60) * 1000 - 1);
    expect(await current()).toBe("t1");
    set(NOW + (3600 - 60) * 1000);
    expect(await current()).toBe("t2");
    expect(obtain).toHaveBeenCalledTimes(2);
  });

  it("takes the skew that the options give", async () => {
    const obtain = vi.fn(issuing(100));
    const { clock, set } = movingClock();
    const current = createTokenCache(obtain, { clock, refreshSkewSeconds: 10 });
    await current();
    set(NOW + 89_999);
    expect(await current()).toBe("t1");
    set(NOW + 90_000);
    expect(await current()).toBe("t2");
  });

  it("obtains a token that is already within the skew again, and keeps none", async () => {
    const obtain = vi.fn(issuing(30));
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    expect(await current()).toBe("t1");
    expect(await current()).toBe("t2");
  });

  it("does not keep a token that has no expiry, since nothing says how long it is good", async () => {
    const obtain = vi.fn(issuing());
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    expect(await current()).toBe("t1");
    expect(await current()).toBe("t2");
    expect(obtain).toHaveBeenCalledTimes(2);
  });

  it("shares one call among the callers that arrive while it runs, and gives them all the same token", async () => {
    const pending = deferred<AccessToken>();
    const obtain = vi.fn(() => pending.promise);
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const callers = [current(), current(), current()];
    pending.resolve(token("shared", 3600));
    expect(await Promise.all(callers)).toStrictEqual(["shared", "shared", "shared"]);
    expect(obtain).toHaveBeenCalledTimes(1);
  });

  it("shares a token that has no expiry among the callers that arrive together, and obtains again for the next", async () => {
    const first = deferred<AccessToken>();
    const obtain = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(token("next"));
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const together = [current(), current()];
    first.resolve(token("first"));
    expect(await Promise.all(together)).toStrictEqual(["first", "first"]);
    expect(await current()).toBe("next");
    expect(obtain).toHaveBeenCalledTimes(2);
  });

  it("calls obtain with no argument, so that no caller's signal reaches work that others share", async () => {
    const obtain = vi.fn(async (..._arguments: unknown[]) => token("t", 3600));
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    await current({ signal: new AbortController().signal });
    expect(obtain).toHaveBeenCalledWith();
  });

  it("ends only the wait of the caller that aborts, and goes on for the others", async () => {
    const pending = deferred<AccessToken>();
    const obtain = vi.fn(() => pending.promise);
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const leaving = new AbortController();
    const reason = new Error("Left the page.");
    const left = failureOf(current({ signal: leaving.signal }));
    const staying = current();
    leaving.abort(reason);
    expect(await left).toBe(reason);
    pending.resolve(token("t1", 3600));
    expect(await staying).toBe("t1");
    expect(await current()).toBe("t1");
    expect(obtain).toHaveBeenCalledTimes(1);
  });

  it("keeps what the call it ended went on to obtain", async () => {
    const pending = deferred<AccessToken>();
    const obtain = vi.fn(() => pending.promise);
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const leaving = new AbortController();
    const left = failureOf(current({ signal: leaving.signal }));
    leaving.abort(new Error("Left."));
    await left;
    pending.resolve(token("t1", 3600));
    expect(await current()).toBe("t1");
    expect(obtain).toHaveBeenCalledTimes(1);
  });

  it("calls nothing when the signal is aborted before the call, even for a token that is kept", async () => {
    const obtain = vi.fn(async () => token("t1", 3600));
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const reason = new Error("Already over.");
    expect(await failureOf(current({ signal: AbortSignal.abort(reason) }))).toBe(reason);
    expect(obtain).not.toHaveBeenCalled();
    await current();
    expect(await failureOf(current({ signal: AbortSignal.abort(reason) }))).toBe(reason);
    expect(obtain).toHaveBeenCalledTimes(1);
  });

  it("gives every waiting caller the failure of the call, and tries again for the next one", async () => {
    const failure = new Error("The token endpoint is down.");
    const pending = deferred<AccessToken>();
    const obtain = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(token("t2", 3600));
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const callers = [failureOf(current()), failureOf(current())];
    pending.reject(failure);
    expect(await Promise.all(callers)).toStrictEqual([failure, failure]);
    expect(await current()).toBe("t2");
    expect(obtain).toHaveBeenCalledTimes(2);
  });

  it("does not report a failure that nobody waits for", async () => {
    const pending = deferred<AccessToken>();
    const current = createTokenCache(() => pending.promise, { clock: movingClock().clock });
    const leaving = new AbortController();
    const left = failureOf(current({ signal: leaving.signal }));
    leaving.abort(new Error("Left."));
    await left;
    pending.reject(new Error("Reset."));
    // An unhandled rejection fails the run; the next turn of the event loop is where it would be reported.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("refuses arguments of other types", () => {
    const { clock } = movingClock();
    const obtain = async () => token("t", 60);
    const cases: readonly [string, () => unknown][] = [
      ["The function obtain must be a function, found null.", () => createTokenCache(JSON.parse("null"), { clock })],
      [
        "The options of createTokenCache must be an object, found null.",
        () => createTokenCache(obtain, JSON.parse("null")),
      ],
      ["The option clock must be an object, found undefined.", () => createTokenCache(obtain, JSON.parse("{}"))],
      [
        "The option refreshSkewSeconds must be a positive integer, found 0.",
        () => createTokenCache(obtain, { clock, refreshSkewSeconds: 0 }),
      ],
      [
        'The option refreshSkewSeconds must be a positive integer, found "60".',
        () => createTokenCache(obtain, { clock, refreshSkewSeconds: JSON.parse('"60"') }),
      ],
    ];
    for (const [message, call] of cases) expect(call, message).toThrow(new DataError(message));
  });

  it("passes the options of a call on to nothing but its own wait", async () => {
    const seen: (CallOptions | undefined)[] = [];
    const current = createTokenCache(
      async (options) => {
        seen.push(options);
        return token("t", 3600);
      },
      { clock: movingClock().clock },
    );
    await current({ signal: new AbortController().signal });
    expect(seen).toStrictEqual([undefined]);
  });

  it("refuses a signal that is not an AbortSignal, and obtains nothing", async () => {
    const obtain = vi.fn(async () => token("t1", 3600));
    const current = createTokenCache(obtain, { clock: movingClock().clock });
    const error = await failureOf(current(JSON.parse('{"signal":{"aborted":false}}')));
    expect(error).toStrictEqual(new DataError("The option signal must be an AbortSignal, found an object."));
    expect(obtain).not.toHaveBeenCalled();
  });
});
