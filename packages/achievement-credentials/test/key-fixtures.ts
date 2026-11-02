/**
 * Keys, documents and a `fetch` for the tests of keys and proofs. The keys come from Web Crypto, and the multibase forms are
 * written here from the multicodec table, so that no expected value comes from the code under test.
 */
import { type Clock, type Fetch, signerFromCryptoKey } from "@interopkit/core";
import { exportJWK, generateKeyPair } from "jose";

// The 58 characters of the bitcoin alphabet: the digits and letters without 0, O, I and l, in the order of ASCII.
const BASE58 = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code))
  .filter((char) => /[1-9A-HJ-NP-Za-km-z]/u.test(char))
  .join("");

/** Writes bytes as a base58btc multibase string (`z` and the digits of base 58). */
export function multibase(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let digits = "";
  while (value > 0n) {
    digits = BASE58[Number(value % 58n)] + digits;
    value /= 58n;
  }
  const zeros = bytes.findIndex((byte) => byte !== 0);
  return `z${BASE58[0]?.repeat(zeros === -1 ? bytes.length : zeros)}${digits}`;
}

function bytesOf(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

/** A key pair, its public JWK, and the signer over its private key. */
export interface TestKey {
  readonly algorithm: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
  /** `publicKeyMultibase` of a Multikey, for the algorithms that have one. */
  readonly multikey?: string;
}

async function generate(algorithm: string, options?: { modulusLength?: number }): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair(algorithm, { extractable: true, ...options });
  const publicJwk = await exportJWK(publicKey);
  if (algorithm === "EdDSA") {
    const raw = bytesOf(publicJwk.x ?? "");
    return { algorithm, privateKey, publicJwk, multikey: multibase(Uint8Array.from([0xed, 0x01, ...raw])) };
  }
  if (algorithm === "ES256" || algorithm === "ES384") {
    const x = bytesOf(publicJwk.x ?? "");
    const y = bytesOf(publicJwk.y ?? "");
    const parity = (y.at(-1) ?? 0) % 2 === 0 ? 0x02 : 0x03;
    const header = algorithm === "ES256" ? [0x80, 0x24] : [0x81, 0x24];
    return { algorithm, privateKey, publicJwk, multikey: multibase(Uint8Array.from([...header, parity, ...x])) };
  }
  return { algorithm, privateKey, publicJwk };
}

/** One key of each algorithm that the verification accepts, made once for the file. */
export const KEYS = {
  rs256: await generate("RS256", { modulusLength: 2048 }),
  es256: await generate("ES256"),
  es384: await generate("ES384"),
  ed25519: await generate("EdDSA"),
  /** A second key of two kinds, for the tests of a key that is not the issuer's. */
  other: await generate("ES256"),
  otherEd25519: await generate("EdDSA"),
};

/** The signer over a test key, with the identifier that its signature names. */
export function signerOf(key: TestKey, keyId?: string) {
  return signerFromCryptoKey(key.privateKey, { algorithm: key.algorithm, ...(keyId === undefined ? {} : { keyId }) });
}

/** A clock that tells a time the test sets. */
export function clockAt(start: number): Clock & { now(): number; set(time: number): void; advance(by: number): void } {
  let time = start;
  return {
    now: () => time,
    set(value) {
      time = value;
    },
    advance(by) {
      time += by;
    },
  };
}

/** What a route answers: a document, or a status with an optional body. */
export type Route = unknown;

/** A `fetch` that serves documents by URL and records the requests. Anything not served is a 404. */
export function serve(routes: Readonly<Record<string, Route>>): { readonly fetch: Fetch; readonly requests: string[] } {
  const requests: string[] = [];
  const fetch: Fetch = async (url) => {
    requests.push(url);
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "number") return new Response("", { status: route });
    if (route instanceof Response) return route.clone();
    return new Response(typeof route === "string" ? route : JSON.stringify(route), { status: 200 });
  };
  return { fetch, requests };
}

/** Reads a base58btc multibase string (`z` and the digits of base 58) into its bytes: the inverse of `multibase`. */
export function fromMultibase(text: string): Uint8Array {
  let value = 0n;
  for (const char of text.slice(1)) {
    const digit = BASE58.indexOf(char);
    if (digit === -1) throw new Error(`${char} is not a digit of base 58.`);
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  const zeros = [...text.slice(1)].findIndex((char) => char !== BASE58[0]);
  return Uint8Array.from([...new Array(zeros === -1 ? text.length - 1 : zeros).fill(0), ...bytes]);
}
