import { DataError, type Signer } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import {
  addProof,
  createContextLoader,
  deriveDisclosure,
  validateJsonLd,
  verifyProof,
} from "../src/data-integrity/index.js";
import type { IssuableCredential } from "../src/index.js";
import { readCredentialJwt, signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver, verifyIssuerKey } from "../src/keys/index.js";
import { handleRefreshRequest, refreshCredential } from "../src/refresh/index.js";
import {
  allocateStatusIndex,
  createStatusList,
  createStatusListCache,
  issueStatusListCredential,
  verifyCredentialStatus,
} from "../src/status/index.js";
import { verifyCredential } from "../src/verify/index.js";

const keys = createKeyResolver({});
const contexts = createContextLoader({ documents: new Map() });
const fetch = async () => new Response("");
const clock = { now: () => 0 };
const signal = new AbortController().signal;
const credential = {} as IssuableCredential;
const signer = {} as Signer;
const list = createStatusList();
const input = {
  id: "https://example.org/status/1",
  issuer: "https://example.org/issuer",
  validFrom: "2024-01-01T00:00:00Z",
  purpose: "revocation" as const,
  list,
};
const request = { method: "GET", url: "https://example.org/refresh/1", headers: {}, body: new Uint8Array() };

/** A call of a public function with the options that the test passes, and the options of the right type that it does not take. */
interface Case {
  readonly name: string;
  readonly call: (options: object) => unknown;
  /** Options with which the function is called. */
  readonly valid: object;
  /** Options of the right type that another function takes and this one does not: they were once accepted and ignored. */
  readonly foreign: Readonly<Record<string, unknown>>;
}

const CASES: readonly Case[] = [
  {
    name: "createContextLoader",
    call: (options) => createContextLoader(options as never),
    valid: {},
    foreign: { cache: { get: async () => undefined, put: async () => undefined }, maxInputBytes: 10, clock, signal },
  },
  {
    name: "createKeyResolver",
    call: (options) => createKeyResolver(options as never),
    valid: {},
    foreign: { maxInputBytes: 10, contexts, signal },
  },
  {
    name: "verifyIssuerKey",
    call: (options) => verifyIssuerKey({} as never, "https://example.org/issuer", options as never),
    valid: { keys },
    foreign: { clock, fetch },
  },
  {
    name: "signCredentialJwt",
    call: (options) => signCredentialJwt(credential, signer, options as never),
    valid: { kid: "https://example.org/keys/1" },
    foreign: { clock, fetch, contexts },
  },
  {
    name: "readCredentialJwt",
    call: (options) => readCredentialJwt("x", options as never),
    valid: { keys },
    foreign: { fetch, timeoutMs: 1000, maxBytes: 1000, contexts, legacyProofs: false, suites: [], maxJsonLdTokens: 10 },
  },
  {
    name: "addProof",
    call: (options) => addProof(credential, signer, options as never),
    valid: { contexts },
    foreign: { keys, fetch, maxInputBytes: 10 },
  },
  {
    name: "deriveDisclosure",
    call: (options) => deriveDisclosure(credential, options as never),
    valid: { selectivePointers: [], contexts },
    foreign: { clock, keys },
  },
  {
    name: "verifyProof",
    call: (options) => verifyProof(credential, options as never),
    valid: { keys, contexts },
    foreign: { algorithms: [], fetch, timeoutMs: 1000, maxBytes: 1000 },
  },
  {
    name: "validateJsonLd",
    call: (options) => validateJsonLd(credential, options as never),
    valid: { contexts },
    foreign: { clock, keys },
  },
  {
    name: "createStatusList",
    call: (options) => createStatusList(options),
    valid: {},
    foreign: { random: { uniform: () => 0.5 }, contexts },
  },
  {
    name: "allocateStatusIndex",
    call: (options) => allocateStatusIndex(new Set(), options as never),
    valid: { length: 8, random: { uniform: () => 0.5 } },
    foreign: { clock },
  },
  {
    name: "issueStatusListCredential",
    call: (options) => issueStatusListCredential(input, signer, options as never),
    valid: { proof: "jwt" },
    foreign: { fetch, keys },
  },
  {
    name: "createStatusListCache",
    call: (options) => createStatusListCache(options),
    valid: {},
    foreign: { fetch, ttlMs: 1000 },
  },
  {
    name: "verifyCredentialStatus",
    call: (options) => verifyCredentialStatus(credential, options as never),
    valid: { fetch, keys },
    foreign: { cache: { get: async () => ({}) }, recipient: { id: "x" }, refresh: false },
  },
  {
    name: "verifyCredential",
    call: (options) => verifyCredential(credential, options as never),
    valid: { keys },
    foreign: { cache: { get: async () => ({}) }, maxEndorsement: 1, ttlSeconds: 1 },
  },
  {
    name: "refreshCredential",
    call: (options) => refreshCredential(credential, options as never),
    valid: { fetch },
    foreign: { keys, contexts, clock },
  },
  {
    name: "handleRefreshRequest",
    call: (options) => handleRefreshRequest(request, options as never),
    valid: { refresh: async () => undefined },
    foreign: { fetch, clock },
  },
];

/** Calls a function and returns what it threw, or `undefined` when it did not throw. */
async function thrownBy(call: () => unknown): Promise<unknown> {
  try {
    await call();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("the options of a public function", () => {
  it.each(CASES)("$name takes the options it declares", async ({ call, valid }) => {
    const thrown = await thrownBy(() => call(valid));
    expect(String((thrown as Error | undefined)?.message)).not.toContain("unexpected property");
  });

  it.each(CASES)("$name refuses an option that no function declares, a misspelled one", async ({ call, valid }) => {
    const thrown = await thrownBy(() => call({ ...valid, timeout: 10 }));
    expect(thrown).toBeInstanceOf(DataError);
    expect((thrown as DataError).message).toContain('unexpected property "timeout"');
  });

  it.each(
    CASES.flatMap(({ name, call, valid, foreign }) =>
      Object.entries(foreign).map(([option, value]) => ({ name, option, value, call, valid })),
    ),
  )(
    "$name refuses $option, which it does not take, though its type is right",
    async ({ call, valid, option, value }) => {
      const thrown = await thrownBy(() => call({ ...valid, [option]: value }));
      expect(thrown).toBeInstanceOf(DataError);
      expect((thrown as DataError).message).toContain(`unexpected property "${option}"`);
    },
  );

  it("refuses one that it does not take whatever its type, as it refuses a declared one of the wrong type", async () => {
    const readJwt = (options: object) => readCredentialJwt("x", { keys, ...options } as never);
    for (const options of [{ suites: "x" }, { suites: [] }, { fetch: 5 }, { fetch }]) {
      expect(await thrownBy(() => readJwt(options))).toBeInstanceOf(DataError);
    }
    expect(await thrownBy(() => readJwt({ maxDepth: "deep" }))).toBeInstanceOf(DataError);
  });
});
