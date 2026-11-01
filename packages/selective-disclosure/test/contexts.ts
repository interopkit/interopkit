import type { CallOptions } from "@interopkit/core";

/** A context that maps every term into one vocabulary, as the contexts of credentials do for what they do not define. */
export const OPEN_CONTEXT = "https://example.test/contexts/open/v1";

/** A context that defines two terms and nothing else, so that any other term is undefined. */
export const CLOSED_CONTEXT = "https://example.test/contexts/closed/v1";

const CONTEXTS: ReadonlyMap<string, unknown> = new Map([
  [
    OPEN_CONTEXT,
    { "@context": { "@version": 1.1, "@vocab": "https://example.test/vocab#", id: "@id", type: "@type" } },
  ],
  [
    CLOSED_CONTEXT,
    {
      "@context": {
        "@version": 1.1,
        id: "@id",
        type: "@type",
        name: "https://example.test/vocab#name",
        proofValue: "https://example.test/vocab#proofValue",
      },
    },
  ],
]);

/** A loader that serves the contexts above from memory and records every URL it is asked for. */
export function memoryContexts(extra: ReadonlyMap<string, unknown> = new Map()): {
  readonly load: (url: string, options?: CallOptions) => Promise<unknown>;
  readonly requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    async load(url) {
      requested.push(url);
      const context = extra.get(url) ?? CONTEXTS.get(url);
      if (context === undefined) throw new Error(`No context for ${url}.`);
      return structuredClone(context);
    },
  };
}

/** A loader that never answers, and a promise that is settled when it has been asked for a context. */
export function hangingContexts(): {
  readonly load: (url: string, options?: CallOptions) => Promise<unknown>;
  readonly asked: Promise<void>;
} {
  let ask: () => void = () => undefined;
  const asked = new Promise<void>((resolve) => {
    ask = resolve;
  });
  return {
    asked,
    load: () => {
      ask();
      return new Promise(() => undefined);
    },
  };
}
