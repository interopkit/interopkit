import { buildAchievementCredential, credentialSummary, type Profile } from "@interopkit/achievement-credentials";
import { bakePng, bakeSvg, readPng, readSvg } from "@interopkit/achievement-credentials/baking";
import { createCredentialsClient } from "@interopkit/achievement-credentials/client";
import { signCredentialJwt } from "@interopkit/achievement-credentials/jwt";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { type VerifyOptions, verifyCredential } from "@interopkit/achievement-credentials/verify";
import { type Clock, type Fetch, ServiceError, SYSTEM_RANDOM } from "@interopkit/core";
import { createStandInContexts } from "./src/contexts.ts";
import { createEmployer, type Shown } from "./src/employer.ts";
import { HOSTED_ASSERTION, hostedBadge } from "./src/hosted-badge.ts";
import { createSigningKey, type SigningKey } from "./src/keys.ts";
import { createNetwork, type Handler } from "./src/network.ts";
import { createUniversity } from "./src/university.ts";
import { createVcApi } from "./src/vc-api.ts";
import { createWallet } from "./src/wallet.ts";

const UNIVERSITY = "https://registrar.example.edu";
const WALLET = "https://wallet.example.org";
const VC_API = "https://vc-api.example.edu";
/** The access token of the learner's wallet, which the learner's apps and the employer send. */
const TOKEN = "863DF0B10F5D432EB2933C2A37CD3135A7BB7B07A68F65D92";
const LEARNER = "did:example:learner";
/** The time the scenario starts: 2 November 2026, 09:00 UTC. */
const START = Date.UTC(2026, 10, 2, 9);
const HOUR_MS = 3_600_000;

/** A PNG of one pixel, which the university bakes a credential into. */
const PIXEL = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

/** What the employer showed of a credential, reduced to what the scenario reports. */
export interface Row {
  readonly name: string | undefined;
  readonly issuer: string | undefined;
  readonly verified: boolean;
  readonly failed: readonly string[];
}

/** What the scenario shows, in plain data. */
export interface ScenarioResult {
  /** What the learner's two uploads to the wallet came to. */
  readonly uploads: readonly string[];
  /** The status of the wallet's answer to a credential that a forger signed with the university's name. */
  readonly forgedUpload: number;
  /** What the employer shows of the wallet's credentials. */
  readonly review: readonly Row[];
  /** The same after the university revoked one credential. */
  readonly afterRevocation: readonly Row[];
  /** The first credential after the university reissued it: the employer follows the refresh service. */
  readonly refreshed: Row;
  /** The credential read out of a PNG and an SVG that the university baked it into, and verified. */
  readonly images: { readonly png: Row; readonly svg: Row };
  /** An Open Badges 2.0 badge that a guild hosts, verified at its address. */
  readonly badgeV2: { readonly name: string; readonly verified: boolean };
  /** The statuses that the VC-API service answered, by operation. */
  readonly vcApi: Readonly<Record<string, number>>;
}

const rowOf = ({ summary, verified, failed }: Shown): Row => ({
  name: summary?.name,
  issuer: summary?.issuerName,
  verified,
  failed,
});

/** Writes the credential of an achievement for a learner, named for an issuer. */
function credentialFor(issuer: Profile, id: string, description: string) {
  return buildAchievementCredential({
    id,
    issuer,
    validFrom: new Date(START).toISOString().replace(/\.\d{3}Z$/u, "Z"),
    name: "Fractions badge",
    description,
    subject: { id: LEARNER },
    achievement: {
      id: `${UNIVERSITY}/achievements/fractions`,
      type: ["Achievement"],
      name: "Fractions",
      description: "Understands fractions as numbers.",
      criteria: { narrative: "Pass the final assessment." },
    },
  });
}

/** Posts a JSON body to the VC-API service, and returns the status and the credential or the answer. */
async function post(fetch: Fetch, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${VC_API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

/** Changes the name of a credential that the service answered with, which breaks its proof. */
function renamed(credential: unknown): unknown {
  return { ...(credential as Record<string, unknown>), name: "Another badge" };
}

/**
 * Runs the VC-API service: an Ed25519 issuer signs a credential and the verifier checks it and refuses it once its name
 * changed; a P-256 issuer writes the base proof of `ecdsa-sd-2023`, which a verifier refuses, and a holder derives from it a
 * disclosure that the verifier accepts.
 */
async function vcApiFlows(fetch: Fetch, edDsa: SigningKey, sd: SigningKey): Promise<Record<string, number>> {
  const check = (credential: unknown) =>
    post(fetch, "/verifiers/default/credentials/verify", { verifiableCredential: credential });
  const signed = await post(fetch, "/issuers/eddsa/credentials/issue", {
    credential: credentialFor(
      { id: edDsa.did, type: ["Profile"], name: "Example Registrar" },
      `${VC_API}/credentials/1`,
      "A badge.",
    ),
  });
  const base = await post(fetch, "/issuers/ecdsa-sd/credentials/issue", {
    credential: credentialFor(
      { id: sd.did, type: ["Profile"], name: "Example Registrar" },
      `${VC_API}/credentials/2`,
      "A badge.",
    ),
  });
  const derived = await post(fetch, "/holders/default/credentials/derive", {
    verifiableCredential: base.body,
    options: { selectivePointers: ["/description"] },
  });
  return {
    issued: signed.status,
    verified: (await check(signed.body)).status,
    verifiedAfterRename: (await check(renamed(signed.body))).status,
    baseProofIssued: base.status,
    baseProofVerified: (await check(base.body)).status,
    disclosureDerived: derived.status,
    disclosureVerified: (await check(derived.body)).status,
  };
}

/**
 * Runs the university as an issuer, a wallet as the Open Badges API that holds the learner's credentials, an employer that
 * reads and verifies them, a guild with a badge of Open Badges 2.0, and a VC-API service over the same functions.
 */
export async function runScenario(): Promise<ScenarioResult> {
  let now = START;
  const clock: Clock = { now: () => now };
  const contexts = await createStandInContexts();
  const jwt = await createSigningKey("ES256");
  const proof = await createSigningKey("EdDSA");
  const university = createUniversity({
    origin: UNIVERSITY,
    clock,
    random: SYSTEM_RANDOM,
    contexts,
    keys: { jwt, proof },
  });

  // The network reaches objects that are made after it, through this table.
  const hosts: Record<string, Handler> = {
    [UNIVERSITY]: (request) => university.handle(request),
    "https://badges.example.org": hostedBadge,
  };
  const fetch = createNetwork(hosts);
  const verify: VerifyOptions & { contexts: typeof contexts } = {
    keys: createKeyResolver({ clock, fetch }),
    clock,
    contexts,
    fetch,
  };
  const wallet = createWallet({ origin: WALLET, token: TOKEN, verify });
  hosts[WALLET] = (request) => wallet.handle(request);

  const edDsa = await createSigningKey("EdDSA");
  const sd = await createSigningKey("ES256");
  const api = createVcApi({
    origin: VC_API,
    random: SYSTEM_RANDOM,
    verify: { ...verify, fetch },
    issuers: {
      eddsa: { id: edDsa.did, algorithm: "EdDSA", signer: edDsa.signer(`${edDsa.did}#${edDsa.multikey}`) },
      "ecdsa-sd": { id: sd.did, algorithm: "ES256", signer: sd.signer(`${sd.did}#${sd.multikey}`) },
    },
  });
  hosts[VC_API] = (request) => api.handle(request);

  const fractions = {
    id: `${UNIVERSITY}/credentials/1`,
    name: "Fractions badge",
    learner: LEARNER,
    achievement: {
      id: `${UNIVERSITY}/achievements/fractions`,
      type: ["Achievement"],
      name: "Fractions",
      description: "Understands fractions as numbers.",
      criteria: { narrative: "Pass the final assessment." },
    },
    proof: "jwt",
  } as const;
  const algebra = {
    ...fractions,
    id: `${UNIVERSITY}/credentials/2`,
    name: "Algebra badge",
    achievement: {
      ...fractions.achievement,
      id: `${UNIVERSITY}/achievements/algebra`,
      name: "Algebra",
      description: "Solves linear equations.",
    },
    proof: "data-integrity",
  } as const;
  const jws = await university.award(fractions);
  const awarded = [jws, await university.award(algebra)];

  // The learner's app and the employer both use the client of the Open Badges API, with the learner's token.
  const learner = createCredentialsClient({ api: "badges", baseUrl: WALLET, fetch, token: async () => TOKEN });
  const uploads: string[] = [];
  for (const credential of awarded) uploads.push(await learner.upsertCredential(credential));

  // A forger signs a credential in the university's name with a key of their own, and the wallet refuses it.
  const forger = await createSigningKey("ES256");
  const forged = await signCredentialJwt(
    credentialFor(
      { id: university.issuer, type: ["Profile"], name: "Example University" },
      `${UNIVERSITY}/credentials/3`,
      "A forgery.",
    ),
    forger.signer(`${UNIVERSITY}/issuers/1#forged`),
    { jwk: forger.publicKeyJwk },
  );
  let forgedUpload = 0;
  try {
    await learner.upsertCredential(forged);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    forgedUpload = error.status;
  }

  const employer = createEmployer({ walletOrigin: WALLET, token: TOKEN, fetch, verify, learner: LEARNER });
  const review = (await employer.review()).map(rowOf);

  university.revoke(algebra.id);
  const afterRevocation = (await employer.review()).map(rowOf);

  // An hour later the university reissues the first credential under a new name, and the copy that the employer holds refreshes to it.
  now += HOUR_MS;
  await university.reissue(fractions.id, "Fractions badge, level 2");
  const refreshed = rowOf(await employer.show(jws));

  const png = rowOf(await employer.show(readPng(bakePng(PIXEL, jws))?.credential ?? ""));
  const svg = rowOf(await employer.show(readSvg(bakeSvg(DRAWING, jws))?.credential ?? ""));

  const badge = await verifyCredential(HOSTED_ASSERTION, {
    ...verify,
    recipient: { identifier: { type: "email", value: "welder@example.org" } },
  });

  return {
    uploads,
    forgedUpload,
    review,
    afterRevocation,
    refreshed,
    images: { png, svg },
    badgeV2: {
      name: badge.credential === undefined ? "" : credentialSummary(badge.credential).name,
      verified: badge.verified,
    },
    vcApi: await vcApiFlows(fetch, edDsa, sd),
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(await runScenario(), null, 2));
}
