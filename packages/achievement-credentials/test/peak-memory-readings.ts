import { readFileSync } from "node:fs";
import { base64url } from "jose";
import { soundAssertion } from "../../../scripts/open-badges-v2-rules.js";
import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import { bakePng, readPng, readSvg } from "../src/baking/index.js";
import { DEFAULT_MAX_BYTES } from "../src/baking/internal.js";
import { addProof, verifyProof } from "../src/data-integrity/index.js";
import { type IssuableCredential, validateCredential } from "../src/index.js";
import { signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { handleCredentialsRequest } from "../src/provider/index.js";
import { readJwsPayload } from "../src/read/internal.js";
import { verifyCredentialStatus } from "../src/status/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential, clrCredential } from "./fixtures.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";
import { ORIGIN, ROOTS, serving } from "./provider-fixture.js";
import { credentialWithStatus, ISSUER, LIST_URL, METHOD, signer, world } from "./status-fixtures.js";
import { badge, jwsOf } from "./verify-fixtures.js";

const MIB = 1024 * 1024;

/** The most tokens of JSON in a credential of an image, a JWS or a body: `maxTokens`. */
const TOKENS = 1_000_000;
/** The tokens of an empty object in a list: its two braces and a comma. */
const TOKENS_PER_OBJECT = 3;

/** The most characters of a JWS, `maxInputBytes`. */
const JWS_LIMIT = 1_048_576;
/** The characters of base64url for each byte of the payload. */
const CHARACTERS_PER_BYTE = 4 / 3;
/** Room left for the header and the signature of the JWS. */
const FRAME_CHARACTERS = 1024;
/** The bytes of a number of one digit and its comma, and of an empty object and its comma. */
const BYTES_PER_NUMBER = 2;
const BYTES_PER_OBJECT = 3;

/** The body of the default limit of a provider, `maxBodyBytes`. */
const BODY_LIMIT = MIB;

/** The characters of the name of each refreshed credential, which a JWS of less than the 1 MiB that a fetch reads holds. */
const NAME_CHARACTERS = 600_000;
/** The credentials that the CLR holds. */
const HELD = 600;

const CLOCK = clockAt(Date.UTC(2024, 5, 14, 12, 0, 0));

const BAKED = JSON.parse(readFileSync(new URL("./fixtures/baking/baked-images.json", import.meta.url), "utf8")) as {
  png: { base: string };
};

/** A JWS of a badge whose `extra` holds as many `items` as its size limit leaves room for, of `bytesEach` bytes of JSON. */
async function crowdedJws(item: unknown, bytesEach: number): Promise<string> {
  const shell = JSON.stringify({ ...badge(), extra: [] });
  const count = Math.floor(((JWS_LIMIT - FRAME_CHARACTERS) / CHARACTERS_PER_BYTE - shell.length) / bytesEach);
  return await jwsOf({ ...badge(), extra: new Array(count).fill(item) });
}

/**
 * A credential whose `evidence` holds as many empty objects as the default limits of a body leave room for: the tokens bound them
 * before the bytes do, and each is an error of the reader.
 */
function crowded(): string {
  const shell = JSON.stringify({ ...achievementCredential(), evidence: [] });
  const count = Math.floor((TOKENS - shell.length) / TOKENS_PER_OBJECT);
  const evidence = new Array(count).fill("{}").join(",");
  return shell.replace('"evidence":[]', `"evidence":[${evidence}]`);
}

/** A credential of a CLR, refreshed by a service that answers a large credential of its own. */
const refreshing = (index: number, name = "A badge") => ({
  ...badge(),
  id: `https://example.edu/credentials/${index}`,
  name,
  refreshService: { id: `https://example.edu/refresh/${index}`, type: "1EdTechCredentialRefresh" },
});

/** The readings of the package, by name. */
export const READINGS = {
  /** A PNG whose credential holds the most objects of JSON that the limits leave. */
  bakingPng: {
    input: () => {
      const count = Math.floor(TOKENS / TOKENS_PER_OBJECT) - 200;
      const credential = { ...achievementCredential(), extra: new Array(count).fill({}) };
      return bakePng(Uint8Array.from(Buffer.from(BAKED.png.base, "base64")), credential);
    },
    read: (image: Uint8Array) => `a ${readPng(image)?.kind}`,
  },
  /** An SVG at the size limit whose credential is one long string. */
  bakingSvg: {
    input: () => {
      const value = "x".repeat(DEFAULT_MAX_BYTES - FRAME_CHARACTERS);
      return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:openbadges="https://purl.imsglobal.org/ob/v3p0"><openbadges:credential><![CDATA[{"a":"${value}"}]]></openbadges:credential></svg>`;
    },
    read: (svg: string) => {
      const read = readSvg(svg);
      const value = read?.kind === "badge" ? (read.credential as { a?: string }).a : undefined;
      return `a ${read?.kind} whose credential is a string of ${value?.length} characters`;
    },
  },
  /** A canonicalization built to exhaust memory: a list of 5,000 alike items. */
  dataIntegrity: {
    input: () => undefined,
    read: async () => {
      const contexts = memoryContexts();
      const did = `did:key:${KEYS.ed25519.multikey}`;
      const honest = await addProof(
        { ...achievementCredential(), issuer: { id: did, type: ["Profile"] } } as unknown as IssuableCredential,
        signerOf(KEYS.ed25519, `${did}#${KEYS.ed25519.multikey}`),
        { clock: CLOCK, contexts: contexts.load },
      );
      const hostile = {
        ...honest,
        extra: { "@list": Array.from({ length: 5000 }, () => 1) },
      } as unknown as IssuableCredential;
      const verdict = await verifyProof(hostile, {
        keys: createKeyResolver({ clock: CLOCK }),
        clock: CLOCK,
        contexts: contexts.load,
      });
      const stopped = JSON.stringify(verdict).includes("1000 runs of the Hash N-Degree Quads algorithm");
      return `valid ${verdict.valid}, ${stopped ? "stopped at 1000 runs of the Hash N-Degree Quads algorithm" : "not stopped by the count of runs"}`;
    },
  },
  /** A JWS at the size limit that holds the most numbers it leaves room for. */
  jwtNumbers: {
    input: () => undefined,
    read: async () => {
      const jws = await crowdedJws(0, BYTES_PER_NUMBER);
      return `verified ${(await verifyCredential(jws, world().options)).verified}`;
    },
  },
  /** A JWS at the size limit that holds the most empty objects it leaves room for. */
  jwtObjects: {
    input: () => undefined,
    read: async () => {
      const jws = await crowdedJws({}, BYTES_PER_OBJECT);
      return `verified ${(await verifyCredential(jws, world().options)).verified}`;
    },
  },
  /** An upsert of a body at the size limit that holds the most objects of JSON. */
  provider: {
    input: () => {
      const body = new TextEncoder().encode(crowded());
      if (body.byteLength > BODY_LIMIT) throw new Error("The body is over the default limit of bytes.");
      return body;
    },
    read: async (body: Uint8Array) => {
      const { options } = serving();
      const response = await handleCredentialsRequest(
        {
          method: "POST",
          url: `${ORIGIN}${ROOTS.badges}/credentials`,
          headers: { "content-type": "application/json", authorization: "Bearer token-all" },
          body,
        },
        options,
      );
      return `status ${response.status}`;
    },
  },
  /** A status list within the fetch limit that inflates to 256 MiB. */
  status: {
    input: async () => {
      const zeros = new Uint8Array(256 * MIB);
      const compressed = new Uint8Array(
        await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
      );
      return `u${base64url.encode(compressed)}`;
    },
    read: async (encodedList: string) => {
      const bomb = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        id: LIST_URL,
        type: ["VerifiableCredential", "BitstringStatusListCredential"],
        issuer: ISSUER,
        validFrom: "2024-06-14T00:00:00Z",
        credentialSubject: {
          id: `${LIST_URL}#list`,
          type: "BitstringStatusList",
          statusPurpose: "revocation",
          encodedList,
        },
      };
      const { options } = world({ [LIST_URL]: await signCredentialJwt(bomb as never, signer, { kid: METHOD }) });
      const result = await verifyCredentialStatus(credentialWithStatus(), options);
      return `${result.outcome}: ${result.detail}`;
    },
  },
  /** An Open Badges 2.0 assertion with a list of a million wrong values, whose findings stop at the limit. */
  v2: {
    input: () => ({
      ...soundAssertion(),
      badge: { ...(soundAssertion().badge as object), tags: new Array(1_000_000).fill(0) },
    }),
    read: (value: unknown) => `${validateCredential(value).length} findings`,
  },
  /** The payload of a JWS of four million empty arrays, refused by its tokens without parsing it. */
  v2Payload: {
    input: () => {
      const payload = `{"a":[${"[],".repeat(4_000_000)}[]]}`;
      return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(payload).toString("base64url")}.c2ln`;
    },
    read: (jws: string) => refusal(() => readJwsPayload(jws, TOKENS)),
  },
  /** A CLR of 600 credentials whose refresh services each answer a credential of 600,000 characters. */
  verify: {
    input: () => undefined,
    read: async () => {
      const held = await Promise.all(Array.from({ length: HELD }, (_, index) => jwsOf(refreshing(index))));
      const clr = await jwsOf({
        ...clrCredential(),
        credentialSubject: { ...(clrCredential().credentialSubject as object), verifiableCredential: held },
      });
      const { options } = world();
      // Each service answers the newer version of its own credential, signed when it is asked for.
      const fetch: typeof options.fetch = async (url, init) => {
        const index = /\/refresh\/(\d+)$/u.exec(url)?.[1];
        if (index === undefined) return await options.fetch(url, init);
        return new Response(await jwsOf(refreshing(Number(index), "x".repeat(NAME_CHARACTERS))), { status: 200 });
      };
      const result = await verifyCredential(clr, { ...options, fetch });
      return `${result.nested.length} credentials of the CLR`;
    },
  },
} satisfies Record<string, Reading>;
