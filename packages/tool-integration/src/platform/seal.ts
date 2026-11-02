import { isRecord } from "@interopkit/core/checks";
import { CompactSign, compactVerify } from "jose";
import { type Claims, hasCanonicalParts } from "../protocol/internal.js";

const ALGORITHM = "HS256";

/** The uses of a sealed token, each the `typ` of its header. */
export type SealUse = "hint" | "login" | "access" | "session-data" | "deep-linking-data";

/**
 * Seals claims as a compact JWS signed with HMAC-SHA-256 (RFC 7515). The sealed token is signed and not encrypted, so
 * whoever holds it can read it. The `use` is the `typ` header, and a token of one use is refused for another (RFC 8725
 * section 3.11). The claims are the platform's: their times are checked by whoever opens the token.
 */
export function sealToken(use: SealUse, claims: Claims, key: CryptoKey): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: ALGORITHM, typ: use })
    .sign(key);
}

/** Opens a token with one key: its claims when the signature is valid and the token is for the use, else `undefined`. */
async function openWith(token: string, use: SealUse, key: CryptoKey): Promise<Claims | undefined> {
  try {
    const { payload, protectedHeader } = await compactVerify(token, key, { algorithms: [ALGORITHM] });
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    return protectedHeader.typ === use && isRecord(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens a sealed token: returns its claims when the signature is valid for one of the keys and the token is for the given
 * use, else `undefined`. The keys are the hint key and the earlier ones of a rotation, in that order.
 */
export async function openToken(token: string, use: SealUse, keys: readonly CryptoKey[]): Promise<Claims | undefined> {
  if (!hasCanonicalParts(token)) return undefined;
  for (const key of keys) {
    const claims = await openWith(token, use, key);
    if (claims !== undefined) return claims;
  }
  return undefined;
}
