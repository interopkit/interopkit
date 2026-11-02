import { type CredentialSummary, credentialSummary } from "@interopkit/achievement-credentials";
import { createCredentialsClient } from "@interopkit/achievement-credentials/client";
import { type VerifyOptions, verifyCredential } from "@interopkit/achievement-credentials/verify";
import type { Fetch } from "@interopkit/core";

/** What the employer is built from. */
export interface EmployerConfig {
  /** The address of the learner's wallet. */
  readonly walletOrigin: string;
  /** The access token that the learner gave. */
  readonly token: string;
  /** Reaches the wallet and, for the verification, the issuers. */
  readonly fetch: Fetch;
  /** The options of every verification: the keys, the clock, the contexts and the `fetch`. */
  readonly verify: VerifyOptions;
  /** The learner, whom the credentials must name. */
  readonly learner: string;
}

/** What the employer shows of one credential. */
export interface Shown {
  /** Whether the credential may be treated as verified. */
  readonly verified: boolean;
  /** The checks that did not pass, by name. */
  readonly failed: readonly string[];
  /** What a wallet shows of the credential, when the proof secures it. */
  readonly summary: CredentialSummary | undefined;
}

/** Reads the credentials of a learner from the wallet the learner names, verifies each as Open Badges 9 says, and shows them. */
export function createEmployer(config: EmployerConfig) {
  const { walletOrigin, token, fetch, verify, learner } = config;
  const client = createCredentialsClient({ api: "badges", baseUrl: walletOrigin, fetch, token: async () => token });
  return {
    /** Verifies one credential, as a JWS or as an object, for the learner. */
    async show(credential: string | object): Promise<Shown> {
      const result = await verifyCredential(credential, { ...verify, recipient: { id: learner } });
      return {
        verified: result.verified,
        failed: result.checks
          .filter(({ outcome }) => outcome === "failed" || outcome === "unavailable")
          .map(({ check }) => check),
        summary: result.credential === undefined ? undefined : credentialSummary(result.credential),
      };
    },
    /** Shows every credential in the wallet, in the order the wallet lists them. */
    async review(): Promise<readonly Shown[]> {
      const shown: Shown[] = [];
      for await (const credential of client.listCredentials()) shown.push(await this.show(credential));
      return shown;
    },
  };
}
