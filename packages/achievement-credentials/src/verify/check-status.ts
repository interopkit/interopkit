import type { VerificationCheck } from "../model/index.js";
import { verifyCredentialStatusWith } from "../status/internal.js";
import type { Authentic } from "./authenticate.js";
import type { Context } from "./context.js";

/**
 * Checks the status of a credential against its status list (Open Badges 9.1, Bitstring Status List 3.2), with the settings of
 * the verification: the list credential is verified as strictly as the credential is.
 */
export async function checkStatus({ credential }: Authentic, context: Context): Promise<VerificationCheck> {
  return await verifyCredentialStatusWith(credential, context.settings);
}
