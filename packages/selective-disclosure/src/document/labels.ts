import { base64urlnopad } from "@scure/base";
import { MULTIBASE_BASE64URL } from "../suite.js";
import type { LabelMapFactory } from "./primitives.js";

const encoder = new TextEncoder();

/**
 * Makes the function that gives each blank node of a document the label that an HMAC of its canonical label makes, as
 * createHmacIdLabelMapFunction does (Data Integrity ECDSA Cryptosuites, section 3.4.4): the same key gives the same labels,
 * and without the key a label says nothing of the blank node.
 *
 * @remarks
 * The HMAC is SHA-256 in Web Crypto. The function of the primitives encodes the label with a library that needs the `Buffer` of
 * Node.js wherever a bundler does not apply the `browser` field of its package, as esbuild does not, so a worker without
 * Node.js compatibility could not run it.
 *
 * @param hmacKey - The key of the HMAC.
 */
export async function hmacLabelMap(hmacKey: Uint8Array): Promise<LabelMapFactory> {
  // A copy: Web Crypto takes bytes over an ArrayBuffer, and these may lie over another kind of buffer.
  const key = await crypto.subtle.importKey("raw", new Uint8Array(hmacKey), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return async ({ canonicalIdMap }) => {
    const labels = await Promise.all(
      [...canonicalIdMap].map(async ([input, canonical]) => {
        const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
        return [input, `${MULTIBASE_BASE64URL}${base64urlnopad.encode(digest)}`] as const;
      }),
    );
    return new Map(labels);
  };
}
