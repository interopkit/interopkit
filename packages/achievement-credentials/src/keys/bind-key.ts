import { ServiceError } from "@interopkit/core";
import type { KeyResolver, VerificationKey } from "../model/index.js";
import { verifyIssuerKey } from "./verify-issuer-key.js";

/** What a proof reader needs to bind a key to the issuer of the credential it secures. */
export interface BindSettings {
  /** Reads what the issuer publishes. */
  readonly keys: KeyResolver;
  /** Skip the binding, and report the key as not bound. */
  readonly allowUnboundKeys: boolean;
  /** Ends the caller's wait. */
  readonly signal: AbortSignal | undefined;
}

/**
 * Binds the key of a proof to the issuer of its credential, as the readers of a proof do.
 *
 * @returns Whether the key is bound, or the reason that it is not. With `allowUnboundKeys` nothing is looked up and the key
 * is not bound.
 * @throws `ServiceError` when what the issuer publishes cannot be read.
 */
export async function bindKey(
  key: VerificationKey,
  issuer: string,
  settings: BindSettings,
): Promise<{ readonly bound: boolean } | { readonly reason: string }> {
  if (settings.allowUnboundKeys) return { bound: false };
  const binding = await verifyIssuerKey(key, issuer, {
    keys: settings.keys,
    ...(settings.signal === undefined ? {} : { signal: settings.signal }),
  });
  if (binding.outcome === "unavailable") throw new ServiceError(binding.detail, 0, "");
  return binding.outcome === "passed" ? { bound: true } : { reason: binding.detail };
}
