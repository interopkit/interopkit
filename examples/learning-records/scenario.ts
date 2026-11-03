import { createCryptoKeySigner } from "@interopkit/core";
import type { About, Activity, Person } from "@interopkit/learning-records";
import { ANA, BUDI, DIRECTORY, ORIGIN, STATISTICS } from "./src/campus.ts";
import { clientFor, DASHBOARD, PLATFORM } from "./src/clients.ts";
import { activityOf, certificateOf, completions } from "./src/dashboard.ts";
import { createLrs } from "./src/lrs.ts";
import { readProgress, saveProgress, sendCertificate, sendCourse, voidMistake } from "./src/platform.ts";

/** The time that the campus LRS starts at: each request of the scenario is one second later. */
const START = Date.parse("2026-03-02T08:00:00.000Z");

/** The registrations of the two attempts. */
const ANA_ATTEMPT = "11111111-1111-4111-8111-111111111111";
const BUDI_ATTEMPT = "22222222-2222-4222-8222-222222222222";

/** What the scenario shows, in plain data. */
export interface ScenarioResult {
  /** The statuses of a request with no credential, and of a write by the dashboard, which may only read. */
  readonly refused: { readonly withoutCredential: number; readonly dashboardWrite: number };
  /** The ids of the Statements of Ana's course, and whether sending the batch again gave the same ids and stored nothing new. */
  readonly ana: { readonly ids: readonly string[]; readonly resent: boolean };
  /** The ids of Budi's. */
  readonly budi: { readonly ids: readonly string[] };
  /** The mistake that the platform voided: a query by id finds nothing, and a query for voided Statements finds it. */
  readonly voided: { readonly asked: "undefined" | "found"; readonly askedAsVoided: "undefined" | "found" };
  /** The completions of the course, in pages of one. */
  readonly completions: { readonly learners: readonly string[]; readonly pages: number };
  /** The verbs of the Statements about Ana, as `ids` formats them: the voided Statement is not among them. */
  readonly anaVerbs: readonly string[];
  /** The certificate that was signed and sent with its Attachment, as the dashboard reads it. */
  readonly certificate: { readonly signatureValid: boolean; readonly text: string } | undefined;
  /** What the writes of the progress of Ana came to, as a second device and a stale copy made them. */
  readonly progress: readonly string[];
  /** The preferences of Ana after a replacement and a merge. */
  readonly preferences: unknown;
  /** What the LRS says of itself, of Ana, and of the course. */
  readonly about: About;
  readonly person: Person;
  readonly course: Activity;
  /** How many Statements the LRS holds. */
  readonly held: number;
}

/**
 * Runs the campus: a learning platform sends the work of two learners to an LRS, and a dashboard reads it. Both reach the LRS
 * through its handler, over a `fetch` that needs no network.
 */
export async function runScenario(): Promise<ScenarioResult> {
  let ticks = 0;
  const clock = { now: () => START + 1000 * ticks++ };
  const writer = ["statements.write", "state.write", "profiles.write"] as const;
  const reader = ["statements.read", "state.read", "profiles.read", "activities.read", "agents.read"] as const;
  const lrs = createLrs({
    origin: ORIGIN,
    clock,
    directory: DIRECTORY,
    credentials: [
      {
        ...PLATFORM,
        authority: { account: { homePage: ORIGIN, name: PLATFORM.user } },
        actions: [...reader, ...writer],
      },
      { ...DASHBOARD, authority: { account: { homePage: ORIGIN, name: DASHBOARD.user } }, actions: reader },
    ],
  });
  const platform = clientFor(lrs.fetch, PLATFORM);
  const dashboard = clientFor(lrs.fetch, DASHBOARD);
  const platformAgent = { account: { homePage: ORIGIN, name: PLATFORM.user } };

  // Two requests that a client of the library would not make: one with no credential, one that writes with a reading credential.
  const url = `${ORIGIN}/xapi/statements`;
  const version = { "x-experience-api-version": "2.0.0" };
  const withoutCredential = await lrs.handle({ method: "GET", url, headers: version, body: new Uint8Array() });
  const dashboardWrite = await lrs.handle({
    method: "POST",
    url,
    headers: {
      ...version,
      "content-type": "application/json",
      authorization: `Basic ${btoa(`${DASHBOARD.user}:${DASHBOARD.password}`)}`,
    },
    body: new TextEncoder().encode("[]"),
  });

  const at = (minutes: number): string => new Date(START + minutes * 60_000).toISOString();
  const ana = await sendCourse(platform, ANA, ANA_ATTEMPT, [at(1), at(2), at(3)]);
  const held = lrs.stores.count();
  const again = await sendCourse(platform, ANA, ANA_ATTEMPT, [at(1), at(2), at(3)]);
  const resent = again.ids.join() === ana.ids.join() && lrs.stores.count() === held;
  const budi = await sendCourse(platform, BUDI, BUDI_ATTEMPT, [at(4), at(5), at(6)], { nameInIndonesian: true });

  const mistake = await voidMistake(platform, BUDI, platformAgent, at(7));
  const found = (value: unknown) => (value === undefined ? "undefined" : "found");

  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const certificateId = await sendCertificate(
    platform,
    ANA,
    createCryptoKeySigner(privateKey, { algorithm: "RS256" }),
    at(8),
  );

  const first = await saveProgress(platform, ANA, 3);
  const read = await readProgress(platform, ANA);
  const secondDevice = await saveProgress(platform, ANA, 5, read?.tag);
  const stale = await saveProgress(platform, ANA, 4, read?.tag);
  const duplicate = await saveProgress(platform, ANA, 1);
  const preferences = { resource: "agent-profile", agent: ANA, profileId: "preferences" } as const;
  const json = (value: unknown) => ({
    contentType: "application/json",
    body: new TextEncoder().encode(JSON.stringify(value)),
  });
  await platform.putDocument(preferences, json({ theme: "dark", language: "en" }), {
    precondition: { ifNoneMatch: "*" },
  });
  const stored = await platform.getDocument(preferences);
  await platform.postDocument(preferences, { language: "id" }, { precondition: { ifMatch: stored?.etag ?? "" } });
  const merged = await platform.getDocument(preferences);

  return {
    refused: { withoutCredential: withoutCredential.status, dashboardWrite: dashboardWrite.status },
    ana: { ids: ana.ids, resent },
    budi: { ids: budi.ids },
    voided: {
      asked: found(await dashboard.getStatement(mistake)),
      askedAsVoided: found(await dashboard.getStatement(mistake, { voided: true })),
    },
    completions: await completions(dashboard, 1),
    anaVerbs: await activityOf(dashboard, ANA),
    certificate: await certificateOf(dashboard, certificateId, publicKey),
    progress: [first, secondDevice, stale, duplicate].map(({ outcome }) => outcome),
    preferences: JSON.parse(new TextDecoder().decode(merged?.body)),
    about: await dashboard.about(),
    person: await dashboard.getPerson(ANA),
    course: await dashboard.getActivity(STATISTICS),
    held: lrs.stores.count(),
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(await runScenario(), undefined, 2));
}
