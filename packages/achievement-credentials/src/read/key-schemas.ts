/**
 * The schemas that read the models of keys (OB B.6): a Multikey, a JWK and a JWK Set.
 *
 * @module
 */

import { openRecord, type Schema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { JWK, JWKS, Multikey } from "../model/index.js";
import { many, ref, text } from "./primitives.js";

export const multikeySchema: Schema<Multikey> = strictRecord({
  id: text,
  type: v.optional(text),
  cryptosuite: text,
  controller: v.optional(text),
  publicKeyMultibase: text,
});

export const jwkSchema: Schema<JWK> = openRecord({
  kty: text,
  use: v.optional(text),
  key_ops: v.optional(text),
  alg: v.optional(text),
  kid: v.optional(text),
  x5u: v.optional(text),
  x5c: v.optional(many(text)),
  x5t: v.optional(text),
  x5t_S256: v.optional(text),
});

export const jwksSchema: Schema<JWKS> = strictRecord({
  keys: many(
    ref(() => jwkSchema),
    1,
  ),
});
