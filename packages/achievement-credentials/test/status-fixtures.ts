/** An issuer that publishes a key, the status list credentials it issues, and the credentials that name them. */
import type { Fetch } from "@interopkit/core";
import type { IssuableCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import {
  createStatusList,
  issueStatusListCredential,
  type StatusList,
  setCredentialStatus,
} from "../src/status/index.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, KEYS, serve, signerOf } from "./key-fixtures.js";

export const ISSUER = "https://example.edu/issuers/1";
export const LIST_URL = "https://example.edu/status/revocations/1";
export const METHOD = `${ISSUER}#key-1`;
export const NOW = Date.UTC(2024, 5, 14, 12, 0, 0);

/** The controller document of the issuer: the key of the test under `assertionMethod`. */
const CONTROLLER = {
  id: ISSUER,
  verificationMethod: [{ id: METHOD, type: "JsonWebKey", controller: ISSUER, publicKeyJwk: KEYS.es256.publicJwk }],
  assertionMethod: [METHOD],
};

/** A list with the given entries set. */
export function listWith(...indexes: number[]): StatusList {
  return indexes.reduce((list, index) => setCredentialStatus(list, index, true), createStatusList());
}

/** The signer of the issuer, and of an attacker whose key the issuer does not publish. */
export const signer = signerOf(KEYS.es256, METHOD);
export const attacker = signerOf(KEYS.other, METHOD);

/** A credential that names an entry of a status list. */
export function credentialWithStatus(entry: Record<string, unknown> = {}, issuer = ISSUER): IssuableCredential {
  return {
    ...achievementCredential(),
    issuer: { id: issuer, type: ["Profile"] },
    credentialStatus: {
      id: `${LIST_URL}#94567`,
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "94567",
      statusListCredential: LIST_URL,
      ...entry,
    },
  } as unknown as IssuableCredential;
}

/** Issues the list credential of the issuer, as a compact JWS. */
export async function listJws(
  list: StatusList,
  extra: {
    purpose?: "revocation" | "suspension";
    issuer?: string;
    validFrom?: string;
    validUntil?: string;
    ttlMilliseconds?: number;
  } = {},
  by = signer,
): Promise<string> {
  const issued = await issueStatusListCredential(
    { id: LIST_URL, issuer: ISSUER, validFrom: "2024-06-14T00:00:00Z", purpose: "revocation", list, ...extra },
    by,
    { clock: clockAt(NOW) },
  );
  return issued as string;
}

/** A world: a `fetch` that serves the issuer's document and the given routes, a resolver over it, and a clock. */
export function world(routes: Record<string, unknown> = {}) {
  const clock = clockAt(NOW);
  const served = serve({ [ISSUER]: CONTROLLER, ...routes });
  const keys = createKeyResolver({ clock, fetch: served.fetch });
  return { ...served, clock, keys, options: { fetch: served.fetch as Fetch, keys, clock } };
}
