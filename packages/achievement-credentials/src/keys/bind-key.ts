import type { KeyResolver, VerificationCheck, VerificationKey } from "../model/index.js";
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
 * Binds the key of a proof to the issuer of its credential, as every reader of a proof does.
 *
 * @returns The `issuer` check of `verifyIssuerKey`: `passed`, `failed` with the reason, or `unavailable` when what the issuer
 * publishes cannot be read; `skipped` with `allowUnboundKeys`, when nothing is looked up.
 */
export async function bindKey(
  key: VerificationKey,
  issuer: string,
  settings: BindSettings,
): Promise<VerificationCheck> {
  if (settings.allowUnboundKeys) {
    return {
      check: "issuer",
      outcome: "skipped",
      detail: "The option allowUnboundKeys is set: the key was not tied to the issuer.",
    };
  }
  return await verifyIssuerKey(key, issuer, {
    keys: settings.keys,
    ...(settings.signal === undefined ? {} : { signal: settings.signal }),
  });
}
