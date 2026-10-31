import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callService, DataError, DEFAULT_TIMEOUT_MS, type Fetch, ServiceError } from "../src/index.js";

const URL_OF_SERVICE = "https://platform.example/jwks";
const WHAT = "The key set at https://platform.example/jwks";
const GET = { method: "GET", headers: { accept: "application/json" } } as const;
/** The most bytes of an answer, which the service guide states. */
const LIMIT = 65_536;
/** A deadline that a test waits for: it ends the wait of a call that no answer will end. */
const SHORT_DEADLINE_MS = 20;
const encoder = new TextEncoder();

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

/** Answers with a body that arrives in the given chunks. */
function answerWith(chunks: readonly Uint8Array[], init: ResponseInit = { status: 200 }): Response {
  let next = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[next];
        next += 1;
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    }),
    init,
  );
}

/**
 * A body that sends its first chunk and then waits for ever. `waiting` settles when the reader asks for more, and
 * `cancelled` when the reader is cancelled.
 */
function stalledBody(first: Uint8Array): {
  readonly response: Response;
  readonly waiting: Promise<void>;
  readonly cancelled: Promise<unknown>;
} {
  const waiting = deferred<void>();
  const cancelled = deferred<unknown>();
  let sent = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          waiting.resolve();
          return new Promise<void>(() => undefined);
        }
        sent = true;
        controller.enqueue(first);
        return undefined;
      },
      cancel: cancelled.resolve,
    }),
    { status: 200 },
  );
  return { response, waiting: waiting.promise, cancelled: cancelled.promise };
}

/** An answer of the given size whose body reports the moment its reader is cancelled. */
function bodyOfBytes(
  size: number,
  init: ResponseInit = { status: 200 },
): { readonly response: Response; readonly cancelled: Promise<unknown> } {
  const { promise, resolve } = deferred<unknown>();
  let sent = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = Math.min(8_192, size - sent);
        if (piece === 0) controller.close();
        else controller.enqueue(new Uint8Array(piece).fill(97));
        sent += piece;
      },
      cancel: resolve,
    }),
    init,
  );
  return { response, cancelled: promise };
}

/** A `fetch` that settles when its signal aborts, as the web standard one does, and keeps the signal it got. */
function honoringFetch(): { readonly fetch: Fetch; readonly signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const fetch: Fetch = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      signals.push(init.signal);
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  return { fetch, signals };
}

/** A `fetch` that never settles and ignores its signal. */
const ignoringFetch: Fetch = () => new Promise<Response>(() => undefined);

const answering =
  (response: () => Response): Fetch =>
  () =>
    Promise.resolve(response());

/** Runs a call and returns what it rejects with. */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("The call resolved.");
}

describe("a successful answer", () => {
  it("returns the body of a 2xx answer as text", async () => {
    const fetch = answering(() => new Response('{"keys":[]}', { status: 200 }));
    await expect(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET)).resolves.toBe(
      '{"keys":[]}',
    );
  });

  it("returns the empty string for an answer with no body", async () => {
    const fetch = answering(() => new Response(null, { status: 204 }));
    await expect(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET)).resolves.toBe("");
  });

  it("decodes a character that is split between two chunks", async () => {
    const bytes = encoder.encode("café \u{1F600}");
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
    const fetch = answering(() => answerWith(chunks));
    await expect(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET)).resolves.toBe(
      "café \u{1F600}",
    );
  });

  it("accepts an answer of exactly the most bytes", async () => {
    const { response } = bodyOfBytes(LIMIT);
    const body = await callService(
      { fetch: answering(() => response), timeoutMs: DEFAULT_TIMEOUT_MS },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    expect(body).toHaveLength(LIMIT);
  });

  it("returns any text, however its bytes are split into chunks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: "grapheme" }),
        fc.array(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 12 }),
        async (text, sizes) => {
          const bytes = encoder.encode(text);
          const chunks: Uint8Array[] = [];
          for (let start = 0, index = 0; start < bytes.length; index += 1) {
            const size = sizes[index % sizes.length] ?? 1;
            chunks.push(bytes.slice(start, start + size));
            start += size;
          }
          const fetch = answering(() => answerWith(chunks));
          const body = await callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET);
          expect(body).toBe(new TextDecoder().decode(bytes));
        },
      ),
      { seed: 20_261_101, numRuns: 100 },
    );
  });
});

describe("the request", () => {
  it("passes the method, the headers and the body it is given, and never follows a redirect", async () => {
    const seen: { url: string; init: Parameters<Fetch>[1] }[] = [];
    const fetch: Fetch = (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(new Response("ok"));
    };
    const init = { method: "POST", headers: { "content-type": "text/plain" }, body: "grant_type=x" } as const;
    await callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, "https://platform.example/token", init);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://platform.example/token");
    expect(seen[0]?.init).toMatchObject({ ...init, redirect: "manual" });
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("calls fetch as a bare function, so that a global fetch works whatever its receiver rules", async () => {
    const receivers: unknown[] = [];
    const service = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      fetch(this: unknown): Promise<Response> {
        receivers.push(this);
        return Promise.resolve(new Response("ok"));
      },
    };
    await callService(service, WHAT, URL_OF_SERVICE, GET);
    expect(receivers).toStrictEqual([undefined]);
  });

  it("gives fetch a signal that joins the signal of the caller and the deadline", async () => {
    const seen = honoringFetch();
    const controller = new AbortController();
    const call = callService(
      { fetch: seen.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    const reason = new Error("The page was left.");
    controller.abort(reason);
    await failureOf(call);
    expect(seen.signals[0]?.aborted).toBe(true);
    expect(seen.signals[0]?.reason).toBe(reason);
  });
});

describe("a service that does not answer", () => {
  it("rejects with a ServiceError of status 0 that names the service and the reason when fetch rejects", async () => {
    const fetch: Fetch = () => Promise.reject(new TypeError("fetch failed"));
    const error = await failureOf(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET));
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      message: "The key set at https://platform.example/jwks did not answer: fetch failed.",
      status: 0,
      body: "",
    });
  });

  it("rejects with status 0 when fetch rejects with a value that is not an Error", async () => {
    const fetch: Fetch = () => Promise.reject("offline");
    const error = await failureOf(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET));
    expect(error).toMatchObject({ message: `${WHAT} did not answer: offline.`, status: 0 });
  });

  it("rejects with status 0 at the deadline when fetch ignores its signal", async () => {
    const error = await failureOf(
      callService({ fetch: ignoringFetch, timeoutMs: SHORT_DEADLINE_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ message: `${WHAT} did not answer within ${SHORT_DEADLINE_MS} ms.`, status: 0 });
  });

  it("rejects with status 0 at the deadline when fetch honors its signal and rejects first", async () => {
    const seen = honoringFetch();
    const error = await failureOf(
      callService({ fetch: seen.fetch, timeoutMs: SHORT_DEADLINE_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toMatchObject({ message: `${WHAT} did not answer within ${SHORT_DEADLINE_MS} ms.`, status: 0 });
    expect(seen.signals[0]?.aborted).toBe(true);
  });

  it("rejects with status 0 at the deadline when the body stops arriving, and cancels the reader", async () => {
    const { response, cancelled } = stalledBody(encoder.encode("{"));
    const error = await failureOf(
      callService({ fetch: answering(() => response), timeoutMs: SHORT_DEADLINE_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toMatchObject({ message: `${WHAT} did not answer within ${SHORT_DEADLINE_MS} ms.`, status: 0 });
    await cancelled;
  });

  it("releases the body of an answer that arrives after the call gave up", async () => {
    const late = deferred<Response>();
    const error = failureOf(
      callService({ fetch: () => late.promise, timeoutMs: SHORT_DEADLINE_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    await error;
    const { response, cancelled } = bodyOfBytes(10);
    late.resolve(response);
    await cancelled;
  });

  it("does not report a failure of a late fetch that nobody waits for", async () => {
    const late = deferred<Response>();
    await failureOf(
      callService({ fetch: () => late.promise, timeoutMs: SHORT_DEADLINE_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    late.reject(new Error("The connection was reset."));
    // An unhandled rejection fails the run; the next turn of the event loop is where it would be reported.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});

describe("a service that answers with an error", () => {
  it("rejects with the status and the body of an answer that is not 2xx", async () => {
    const fetch = answering(() => new Response('{"error":"busy"}', { status: 503 }));
    const error = await failureOf(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET));
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ message: `${WHAT} answered 503.`, status: 503, body: '{"error":"busy"}' });
  });

  it.each([301, 302, 303, 307, 308])(
    "refuses a %i answer as a redirect that the call does not follow",
    async (status) => {
      const fetch = answering(
        () => new Response("moved", { status, headers: { location: "http://elsewhere.example/" } }),
      );
      const error = await failureOf(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET));
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        message: `${WHAT} answered with a redirect (${status}), which the call does not follow: use the final address.`,
        status,
        body: "moved",
      });
    },
  );

  it("refuses the opaque redirect that a browser gives for a manual redirect", async () => {
    const opaque = () =>
      Object.defineProperties(new Response(null, { status: 200 }), {
        type: { value: "opaqueredirect" },
        status: { value: 0 },
        ok: { value: false },
      });
    const error = await failureOf(
      callService({ fetch: answering(opaque), timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toMatchObject({
      message: `${WHAT} answered with a redirect (0), which the call does not follow: use the final address.`,
      status: 0,
      body: "",
    });
  });

  it("refuses an answer of one byte more than the most bytes", async () => {
    const { response } = bodyOfBytes(LIMIT + 1);
    const error = await failureOf(
      callService({ fetch: answering(() => response), timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toMatchObject({ message: `${WHAT} answered with more than 65536 bytes.`, status: 200 });
  });

  it("refuses an answer of more than the most bytes, cancels the reader and keeps what it read", async () => {
    const { response, cancelled } = bodyOfBytes(2 * LIMIT);
    const error = await failureOf(
      callService({ fetch: answering(() => response), timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ message: `${WHAT} answered with more than 65536 bytes.`, status: 200 });
    expect((error as ServiceError).body).toHaveLength(LIMIT);
    await cancelled;
  });

  it("reads the body of an error answer up to the same limit", async () => {
    const { response, cancelled } = bodyOfBytes(3 * LIMIT, { status: 500 });
    const error = await failureOf(
      callService({ fetch: answering(() => response), timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toMatchObject({ message: `${WHAT} answered 500.`, status: 500 });
    expect((error as ServiceError).body).toHaveLength(LIMIT);
    await cancelled;
  });
});

describe("a caller that aborts", () => {
  it("rejects with the reason of the signal and calls no fetch when it is aborted before the call", async () => {
    let calls = 0;
    const fetch: Fetch = () => {
      calls += 1;
      return Promise.resolve(new Response("ok"));
    };
    const reason = new Error("The candidate left the item.");
    const error = await failureOf(
      callService(
        { fetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: AbortSignal.abort(reason) },
        WHAT,
        URL_OF_SERVICE,
        GET,
      ),
    );
    expect(error).toBe(reason);
    expect(calls).toBe(0);
  });

  it("rejects with the reason of the signal when it aborts while fetch is pending, even if fetch ignores it", async () => {
    const controller = new AbortController();
    const call = callService(
      { fetch: ignoringFetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    const reason = new Error("The wait ended.");
    controller.abort(reason);
    expect(await failureOf(call)).toBe(reason);
  });

  it("rejects with the reason of the signal when fetch aborts it before it returns", async () => {
    const controller = new AbortController();
    const fetch: Fetch = () => {
      controller.abort();
      return new Promise<Response>(() => undefined);
    };
    const error = await failureOf(
      callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal }, WHAT, URL_OF_SERVICE, GET),
    );
    expect(error).toBe(controller.signal.reason);
  });

  it("rejects with the reason of the signal when fetch rejects with its own abort error", async () => {
    const seen = honoringFetch();
    const controller = new AbortController();
    const call = callService(
      { fetch: seen.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    controller.abort();
    const error = await failureOf(call);
    expect(error).toBe(controller.signal.reason);
    expect(error).not.toBeInstanceOf(ServiceError);
  });

  it("rejects with the reason of the signal when it aborts while the body is read, and cancels the reader", async () => {
    const { response, waiting, cancelled } = stalledBody(encoder.encode("{"));
    const controller = new AbortController();
    const call = callService(
      { fetch: answering(() => response), timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    const reason = new Error("The wait ended.");
    await waiting;
    controller.abort(reason);
    expect(await failureOf(call)).toBe(reason);
    await cancelled;
  });

  it("leaves a later call without the signal unaffected", async () => {
    const controller = new AbortController();
    const fetch = answering(() => new Response("ok"));
    controller.abort();
    await failureOf(
      callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: controller.signal }, WHAT, URL_OF_SERVICE, GET),
    );
    await expect(callService({ fetch, timeoutMs: DEFAULT_TIMEOUT_MS }, WHAT, URL_OF_SERVICE, GET)).resolves.toBe("ok");
  });
});

describe("calls repeated and in parallel", () => {
  it("makes one request per call and keeps nothing between them", async () => {
    let calls = 0;
    const fetch: Fetch = () => {
      calls += 1;
      return Promise.resolve(new Response(`answer ${calls}`));
    };
    const service = { fetch, timeoutMs: DEFAULT_TIMEOUT_MS };
    const answers = await Promise.all([
      callService(service, WHAT, URL_OF_SERVICE, GET),
      callService(service, WHAT, URL_OF_SERVICE, GET),
    ]);
    expect(answers.toSorted()).toStrictEqual(["answer 1", "answer 2"]);
  });

  it("ends only the call whose signal aborts", async () => {
    const first = new AbortController();
    const second = deferred<Response>();
    const ended = callService(
      { fetch: ignoringFetch, timeoutMs: DEFAULT_TIMEOUT_MS, signal: first.signal },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    const running = callService(
      { fetch: () => second.promise, timeoutMs: DEFAULT_TIMEOUT_MS },
      WHAT,
      URL_OF_SERVICE,
      GET,
    );
    first.abort();
    await failureOf(ended);
    second.resolve(new Response("still here"));
    await expect(running).resolves.toBe("still here");
  });
});

describe("the options", () => {
  it("refuses a fetch that is not a function", async () => {
    const service = JSON.parse(`{"fetch": "https", "timeoutMs": 10}`);
    const error = await failureOf(callService(service, WHAT, URL_OF_SERVICE, GET));
    expect(error).toStrictEqual(new DataError('The option fetch must be a function, found "https".'));
  });

  it.each([0, -1, 1.5, "10", null])("refuses a timeout of %j", async (timeoutMs) => {
    const service = { fetch: answering(() => new Response("ok")), timeoutMs };
    const error = await failureOf(callService(service as never, WHAT, URL_OF_SERVICE, GET));
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toMatch(/^The option timeoutMs must be a positive integer, found /);
  });

  it("refuses a signal that is not an AbortSignal", async () => {
    const service = {
      fetch: answering(() => new Response("ok")),
      timeoutMs: 10,
      signal: JSON.parse('{"aborted":false}'),
    };
    const error = await failureOf(callService(service, WHAT, URL_OF_SERVICE, GET));
    expect(error).toStrictEqual(new DataError("The option signal must be an AbortSignal, found an object."));
  });

  it("states the default deadline as 10,000 ms", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});
