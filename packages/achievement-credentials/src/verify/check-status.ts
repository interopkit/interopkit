import type { VerificationCheck } from "../model/index.js";
import { verifyCredentialStatus } from "../status/index.js";
import type { Authentic } from "./authenticate.js";
import type { Context } from "./context.js";
import { fetchOf } from "./options.js";

/**
 * Checks the status of a credential against its status list (Open Badges 9.1, Bitstring Status List 3.2), with the keys, the
 * contexts and the proof options of the verification: the list credential is verified as strictly as the credential is.
 */
export async function checkStatus({ credential }: Authentic, context: Context): Promise<VerificationCheck> {
  const { settings } = context;
  const { jwt } = settings;
  return await verifyCredentialStatus(credential, {
    fetch: fetchOf(settings),
    keys: jwt.keys,
    clock: jwt.clock,
    cache: context.statusLists,
    statusIssuers: settings.statusIssuers,
    timeoutMs: settings.timeoutMs,
    maxBytes: settings.maxBytes,
    maxTokens: jwt.maxTokens,
    algorithms: jwt.algorithms,
    clockSkewSeconds: jwt.clockSkewSeconds,
    allowUnboundKeys: jwt.allowUnboundKeys,
    legacyProofs: settings.legacyProofs,
    suites: settings.suites,
    ...(settings.contexts === undefined ? {} : { contexts: settings.contexts }),
    ...(jwt.signal === undefined ? {} : { signal: jwt.signal }),
  });
}
