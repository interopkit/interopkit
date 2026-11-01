import type { CasePackage, CaseQuery, CFPckgItem } from "@interopkit/competency-frameworks";
import type { CaseClient } from "@interopkit/competency-frameworks/client";
import {
  crosswalk,
  diffPackages,
  type FrameworkNode,
  frameworkTree,
  isNewer,
} from "@interopkit/competency-frameworks/graph";
import type { CallOptions } from "@interopkit/core";

/** Which documents to consider: how to sort and filter, and no selection of fields, since a consumer needs whole documents. */
export type DocumentQuery = Omit<CaseQuery, "fields">;

/** The frameworks a consumer keeps, by the identifier of their document. */
export type Copies = Map<string, CasePackage>;

/** What a synchronization did, by the titles of the frameworks. */
export interface SyncReport {
  /** The frameworks it fetched: new ones, and ones that the provider changed after the copy. */
  readonly fetched: readonly string[];
  /** The frameworks whose copy is as new as the provider's document. */
  readonly current: readonly string[];
}

/** How the consumer shows an item: its code and its statement. */
const describe = ({ humanCodingScheme, fullStatement }: CFPckgItem): string =>
  humanCodingScheme === undefined ? fullStatement : `${humanCodingScheme} ${fullStatement}`;

/**
 * Brings the copies up to date with a provider: lists its documents, and fetches the package of each that the consumer does
 * not hold or that was changed after the copy. The `lastChangeDateTime` of a document changes whenever anything in its
 * framework does, so the list alone says what to fetch.
 *
 * @param client - The client of the provider.
 * @param copies - The frameworks the consumer holds; the fetched ones are set in it.
 * @param query - Which documents to consider. @defaultValue every document
 * @param options - The signal that ends the wait.
 */
export async function syncFrameworks(
  client: CaseClient,
  copies: Copies,
  query: DocumentQuery = {},
  options?: CallOptions,
): Promise<SyncReport> {
  const fetched: string[] = [];
  const current: string[] = [];
  for await (const document of client.documents(query, options)) {
    const copy = copies.get(document.identifier);
    if (copy !== undefined && !isNewer(copy.CFDocument, document)) {
      current.push(document.title);
      continue;
    }
    const framework = await client.package(document.identifier, options);
    // A document that left between the list and the fetch is not a failure: the next synchronization sees the list without it.
    if (framework === undefined) continue;
    copies.set(document.identifier, framework);
    fetched.push(document.title);
  }
  return { fetched, current };
}

/** Writes the outline of a framework: one line for each item, indented by its depth, in the order the framework gives. */
export function outline(framework: CasePackage): readonly string[] {
  const lines: string[] = [];
  const walk = (nodes: readonly FrameworkNode[], depth: number): void => {
    for (const { item, children } of nodes) {
      lines.push(`${"  ".repeat(depth)}${describe(item)}`);
      walk(children, depth + 1);
    }
  };
  walk(frameworkTree(framework), 0);
  return lines;
}

/** Lists how items of one framework are aligned with items of another, such as `U4 exactMatchOf NF.2`. */
export function alignments(from: CasePackage, to: CasePackage): readonly string[] {
  const code = (framework: CasePackage, uri: string): string =>
    (framework.CFItems ?? []).find((item) => item.uri === uri)?.humanCodingScheme ?? uri;
  return crosswalk(from, to).map((link) => `${code(from, link.from)} ${link.type} ${code(to, link.to)}`);
}

/** What changed between two editions of a framework, by the codes of the items. */
export interface Changes {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly replaced: readonly string[];
}

/** Lists the items two editions of a framework differ in. */
export function changesBetween(before: CasePackage, after: CasePackage): Changes {
  const diff = diffPackages(before, after);
  const code = (uri: string): string =>
    [...(after.CFItems ?? []), ...(before.CFItems ?? [])].find((item) => item.uri === uri)?.humanCodingScheme ?? uri;
  return {
    added: diff.added.map(describe),
    changed: diff.changed.map(({ after: item }) => describe(item)),
    replaced: diff.replaced.map(({ item, by }) => `${code(item)} by ${code(by)}`),
  };
}
