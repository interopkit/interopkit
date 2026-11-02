import type { Agent, Statement } from "@interopkit/learning-records";
import type { LrsClient } from "@interopkit/learning-records/client";
import { verifyStatementSignature } from "@interopkit/learning-records/signing";
import { STATISTICS, VERBS } from "./campus.ts";

/** Who completed a course, and how often the dashboard had to ask for another page. */
export interface Completions {
  /** The names of the learners, in the order of their completion, one entry for each completion. */
  readonly learners: readonly string[];
  /** The number of pages that the LRS answered. */
  readonly pages: number;
}

/** The name of an Agent in a report. */
function nameOf(agent: Statement["actor"]): string {
  return agent.name ?? agent.mbox ?? JSON.stringify(agent);
}

/** Lists the completions of a course, oldest first, in pages of a size that the dashboard chooses. */
export async function completions(client: LrsClient, pageSize: number): Promise<Completions> {
  const learners: string[] = [];
  let pages = 0;
  for await (const page of client.queryStatements({
    verb: VERBS.completed.id,
    activity: STATISTICS,
    ascending: true,
    limit: pageSize,
  })) {
    pages += 1;
    for (const statement of page.statements) learners.push(nameOf(statement.actor));
  }
  return { learners, pages };
}

/** What the dashboard knows of the Statements about one learner. */
export async function activityOf(client: LrsClient, learner: Agent): Promise<readonly string[]> {
  const verbs: string[] = [];
  for await (const page of client.queryStatements({ agent: learner, format: "ids" })) {
    for (const statement of page.statements) verbs.push(statement.verb.id.split("/").at(-1) ?? "");
  }
  return verbs;
}

/** A certificate that the dashboard fetched: whether its signature verifies, and what the Attachment holds. */
export interface Certificate {
  readonly signatureValid: boolean;
  readonly text: string;
}

/** Fetches a Statement with its Attachments and checks the signature with the public key of the platform. */
export async function certificateOf(client: LrsClient, id: string, key: CryptoKey): Promise<Certificate | undefined> {
  const found = await client.getStatement(id, { attachments: true });
  if (found === undefined) return undefined;
  const header = found.statement.attachments?.find(({ usageType }) => usageType.endsWith("/signature"));
  const signature = header === undefined ? undefined : found.attachments.get(header.sha2);
  const certificate = found.statement.attachments?.find(({ usageType }) => !usageType.endsWith("/signature"));
  const text = certificate === undefined ? undefined : found.attachments.get(certificate.sha2);
  if (signature === undefined || text === undefined) return undefined;
  const checked = await verifyStatementSignature(found.statement, signature.body, { key });
  return { signatureValid: checked.valid, text: new TextDecoder().decode(text.body) };
}
