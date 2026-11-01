import type { OpenApiDocument } from "@interopkit/competency-frameworks";
import { createCaseClient } from "@interopkit/competency-frameworks/client";
import { ServiceError } from "@interopkit/core";
import { createCatalog } from "./src/catalog.ts";
import {
  alignments,
  type Changes,
  type Copies,
  changesBetween,
  type DocumentQuery,
  outline,
  type SyncReport,
  syncFrameworks,
} from "./src/consumer.ts";
import { pacingGuide } from "./src/district.ts";
import { identifierOf } from "./src/identifiers.ts";
import { MATHEMATICS, MINISTRY_ORIGIN, mathematics2024, mathematics2025, reading2024 } from "./src/ministry.ts";
import { createProvider } from "./src/provider.ts";

/** The credential the ministry gives its consumers. */
const TOKEN = "ministry-token";

/**
 * The file of service discovery in the scenario: the host supplies the file that 1EdTech publishes, and a stand-in with its
 * shape serves here, since a specification file is not part of this repository.
 */
export const DISCOVERY: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "Competencies and Academic Standards Exchange (CASE) Service", version: "1.1" },
  servers: [{ url: "https://{hostName}{basePath}" }],
  paths: { "/CFDocuments": {} },
};

/** What the scenario shows, in plain data. */
export interface ScenarioResult {
  /** The titles of the documents, sorted by title. */
  readonly listing: readonly string[];
  /** The titles of the documents whose title has "math" in it. */
  readonly filtered: readonly string[];
  /** The first synchronization: nothing is held, so both frameworks are fetched. */
  readonly firstSync: SyncReport;
  /** The outline of the copy of the mathematics framework. */
  readonly outline: readonly string[];
  /** How the district's pacing guide is aligned with the ministry's standards. */
  readonly alignments: readonly string[];
  /** The statuses of a consumer with no credential, and with a wrong one. */
  readonly refused: { readonly withoutCredential: number; readonly wrongCredential: number };
  /** The synchronization after the ministry published its second edition: only the changed framework is fetched. */
  readonly secondSync: SyncReport;
  /** What the second edition changed. */
  readonly changes: Changes;
  /** A synchronization when nothing changed: nothing is fetched. */
  readonly thirdSync: SyncReport;
  /** The number of associations of the mathematics framework as a consumer of each version reads them. */
  readonly associationsByVersion: Readonly<Record<"1.0" | "1.1", number>>;
  /** Whether the document that a consumer of each version reads has a `frameworkType`. */
  readonly frameworkTypeByVersion: Readonly<Record<"1.0" | "1.1", boolean>>;
  /** What the client answers for an identifier the provider does not hold. */
  readonly unknownItem: "undefined" | "found";
}

/** Returns the status of the failure a call ended in. */
async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 0;
  } catch (error) {
    if (error instanceof ServiceError) return error.status;
    throw error;
  }
}

/**
 * Runs the ministry as a provider and a school platform as its consumer: the platform lists and filters the documents, keeps
 * copies, reads the outline, aligns its pacing guide, is refused without a credential, and finds what the ministry's second
 * edition changed.
 */
export async function runScenario(): Promise<ScenarioResult> {
  const catalog = createCatalog(MINISTRY_ORIGIN);
  catalog.publish(mathematics2024());
  catalog.publish(reading2024());
  const provider = createProvider({
    catalog,
    origin: MINISTRY_ORIGIN,
    discovery: DISCOVERY,
    token: TOKEN,
  });
  const configuration = { baseUrl: MINISTRY_ORIGIN, fetch: provider.fetch };
  const client = createCaseClient({ ...configuration, authorization: async () => `Bearer ${TOKEN}` });
  const titles = async (query: DocumentQuery): Promise<string[]> => {
    const found: string[] = [];
    for await (const document of client.documents(query)) found.push(document.title);
    return found;
  };

  const listing = await titles({ sort: "title", orderBy: "asc" });
  const filtered = await titles({ filter: { field: "title", predicate: "~", value: "math" } });
  const copies: Copies = new Map();
  const firstSync = await syncFrameworks(client, copies);
  const first = copies.get(identifierOf(MATHEMATICS.document));
  if (first === undefined) throw new Error("The first synchronization did not fetch the mathematics framework.");

  const refused = {
    withoutCredential: await statusOf(createCaseClient(configuration).document(identifierOf(MATHEMATICS.document))),
    wrongCredential: await statusOf(
      createCaseClient({ ...configuration, authorization: async () => "Bearer another" }).document(
        identifierOf(MATHEMATICS.document),
      ),
    ),
  };

  catalog.publish(mathematics2025());
  const secondSync = await syncFrameworks(client, copies);
  const second = copies.get(identifierOf(MATHEMATICS.document));
  if (second === undefined) throw new Error("The second synchronization lost the mathematics framework.");
  const thirdSync = await syncFrameworks(client, copies);

  const legacy = createCaseClient({ ...configuration, version: "1.0", authorization: async () => `Bearer ${TOKEN}` });
  const asOfCase10 = await legacy.package(identifierOf(MATHEMATICS.document));
  const unknown = await client.item(identifierOf(9999));

  return {
    listing,
    filtered,
    firstSync,
    outline: outline(first),
    alignments: alignments(pacingGuide(), first),
    refused,
    secondSync,
    changes: changesBetween(first, second),
    thirdSync,
    associationsByVersion: {
      "1.0": asOfCase10?.CFAssociations?.length ?? 0,
      "1.1": second.CFAssociations?.length ?? 0,
    },
    frameworkTypeByVersion: {
      "1.0": asOfCase10?.CFDocument.frameworkType !== undefined,
      "1.1": second.CFDocument.frameworkType !== undefined,
    },
    unknownItem: unknown === undefined ? "undefined" : "found",
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(await runScenario(), null, 2));
}
