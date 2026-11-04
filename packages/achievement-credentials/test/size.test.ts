// cspell:ignore bnid klona yallist
import { describe, expect, it } from "vitest";
import { type EntrySize, entryPoints, entrySize } from "../../../scripts/entry-size.js";

/**
 * The budget of each entry point of the package, bundled alone as a host's bundler makes it (`scripts/entry-size.ts`): the most
 * bytes after gzip, 1.25 times those measured rounded up to the next 500, and every module other than its own that it holds, so
 * that an import which pulls another module into an entry point fails until the list says so. docs/achievement-credentials/performance.md lists the sizes. A budget
 * changes only with the reason in the commit that changes it.
 */
const ENTRY_BUDGETS: Readonly<Record<string, Pick<EntrySize, "gzip" | "holds">>> = {
  "@interopkit/achievement-credentials": {
    gzip: 26_500,
    holds: [
      "@interopkit/core",
      "@noble/hashes",
      "achievement-credentials/compact-jws",
      "achievement-credentials/compare",
      "achievement-credentials/issue",
      "achievement-credentials/model",
      "achievement-credentials/read",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/baking": {
    gzip: 35_000,
    holds: [
      "@interopkit/core",
      "achievement-credentials/base64url",
      "achievement-credentials/compact-jws",
      "achievement-credentials/json-text",
      "achievement-credentials/model",
      "achievement-credentials/read",
      "saxes",
      "valibot",
      "xmlchars",
    ],
  },
  "@interopkit/achievement-credentials/client": {
    gzip: 25_500,
    holds: [
      "@interopkit/core",
      "achievement-credentials/compact-jws",
      "achievement-credentials/model",
      "achievement-credentials/read",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/keys": {
    gzip: 61_500,
    holds: [
      "@interop/bnid",
      "@interop/data-integrity-core",
      "@interop/did-io",
      "@interop/did-method-key",
      "@interop/did-web-resolver",
      "@interop/ecdsa-multikey",
      "@interop/ed25519-verification-key",
      "@interop/http-client",
      "@interop/lru-memoize",
      "@interop/x25519-key-agreement-key",
      "@interopkit/core",
      "@noble/curves",
      "@noble/ed25519",
      "@noble/hashes",
      "@scure/base",
      "achievement-credentials/base64url",
      "achievement-credentials/json-text",
      "achievement-credentials/model",
      "did-context",
      "jose",
      "lru-cache",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/jwt": {
    gzip: 31_000,
    holds: [
      "@interopkit/core",
      "achievement-credentials/base64url",
      "achievement-credentials/compact-jws",
      "achievement-credentials/json-text",
      "achievement-credentials/keys",
      "achievement-credentials/model",
      "achievement-credentials/option-checks",
      "achievement-credentials/read",
      "jose",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/data-integrity": {
    gzip: 169_500,
    holds: [
      "@digitalbazaar/di-sd-primitives",
      "@digitalbazaar/security-context",
      "@interop/data-integrity-core",
      "@interop/data-integrity-proof",
      "@interop/ecdsa-multikey",
      "@interop/ecdsa-signature",
      "@interop/ed25519-signature",
      "@interop/ed25519-verification-key",
      "@interop/jsonld",
      "@interop/jsonld-signatures",
      "@interopkit/core",
      "@noble/curves",
      "@noble/ed25519",
      "@noble/hashes",
      "@scure/base",
      "achievement-credentials/compact-jws",
      "achievement-credentials/json-text",
      "achievement-credentials/keys",
      "achievement-credentials/model",
      "achievement-credentials/option-checks",
      "achievement-credentials/read",
      "base64url",
      "base64url-universal",
      "canonicalize",
      "cborg",
      "ed25519-signature-2020-context",
      "jose",
      "jsonld",
      "klona",
      "lru-cache",
      "rdf-canonize",
      "selective-disclosure/base",
      "selective-disclosure/derive",
      "selective-disclosure/document",
      "selective-disclosure/keys",
      "selective-disclosure/proof-value",
      "selective-disclosure/suite",
      "selective-disclosure/verify",
      "serialize-error",
      "setimmediate",
      "valibot",
      "yallist",
    ],
  },
  "@interopkit/achievement-credentials/status": {
    gzip: 39_500,
    holds: [
      "@interopkit/core",
      "achievement-credentials/base64url",
      "achievement-credentials/compact-jws",
      "achievement-credentials/json-text",
      "achievement-credentials/jwt",
      "achievement-credentials/keys",
      "achievement-credentials/model",
      "achievement-credentials/option-checks",
      "achievement-credentials/read",
      "jose",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/refresh": {
    gzip: 7000,
    holds: [
      "@interopkit/core",
      "achievement-credentials/compact-jws",
      "achievement-credentials/json-text",
      "achievement-credentials/option-checks",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/verify": {
    gzip: 62_500,
    holds: [
      "@cfworker/json-schema",
      "@interopkit/core",
      "@noble/hashes",
      "achievement-credentials/base64url",
      "achievement-credentials/compact-jws",
      "achievement-credentials/compare",
      "achievement-credentials/issue",
      "achievement-credentials/json-text",
      "achievement-credentials/jwt",
      "achievement-credentials/keys",
      "achievement-credentials/model",
      "achievement-credentials/option-checks",
      "achievement-credentials/read",
      "achievement-credentials/refresh",
      "achievement-credentials/status",
      "jose",
      "valibot",
    ],
  },
  "@interopkit/achievement-credentials/provider": {
    gzip: 45_500,
    holds: [
      "@interopkit/core",
      "achievement-credentials/base64url",
      "achievement-credentials/compact-jws",
      "achievement-credentials/json-text",
      "achievement-credentials/jwt",
      "achievement-credentials/keys",
      "achievement-credentials/model",
      "achievement-credentials/option-checks",
      "achievement-credentials/read",
      "achievement-credentials/status",
      "achievement-credentials/verify",
      "jose",
      "valibot",
    ],
  },
};

const ENTRIES = entryPoints("achievement-credentials");

describe("every entry point bundled alone", () => {
  it("has a budget for each entry point of the package, and none for a name that is not one", () => {
    expect(Object.keys(ENTRY_BUDGETS).sort()).toStrictEqual([...ENTRIES].sort());
  });

  it.each(ENTRIES)("keeps %s within its budget, holding only the modules it lists", async (specifier) => {
    const { gzip, holds } = await entrySize(specifier);
    const budget = ENTRY_BUDGETS[specifier] ?? expect.unreachable(`No budget for ${specifier}.`);
    expect(gzip, `The gzipped bytes of ${specifier}`).toBeLessThan(budget.gzip);
    expect(holds, `The modules other than its own in ${specifier}`).toStrictEqual(budget.holds);
  });
});
