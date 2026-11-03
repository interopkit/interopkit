import type { Signer } from "@interopkit/core";
import {
  type Activity,
  type Agent,
  buildStatement,
  buildVoidingStatement,
  type DocumentTarget,
  type Statement,
} from "@interopkit/learning-records";
import { hashAttachment } from "@interopkit/learning-records/attachments";
import type { LrsClient } from "@interopkit/learning-records/client";
import { signStatement } from "@interopkit/learning-records/signing";
import { idOf, STATISTICS, SURVEY, VERBS } from "./campus.ts";

/** The course, as the first Statement about it defines it. */
const COURSE: Activity = {
  id: STATISTICS,
  definition: { name: { "en-US": "Statistics 101" }, type: "http://adlnet.gov/expapi/activities/course" },
};

/** The survey of the course: a question with one right choice. */
const QUESTION: Activity = {
  id: SURVEY,
  definition: {
    type: "http://adlnet.gov/expapi/activities/cmi.interaction",
    interactionType: "choice",
    correctResponsesPattern: ["median"],
    choices: [
      { id: "mean", description: { "en-US": "The mean" } },
      { id: "median", description: { "en-US": "The median" } },
    ],
  },
};

/** What the platform sent for one learner. */
export interface Course {
  /** The ids of the three Statements of the course, in the order they were sent. */
  readonly ids: readonly string[];
  /** The registration of the attempt, a UUID. */
  readonly registration: string;
}

/**
 * Sends the Statements of a learner who launches the course, answers its survey and completes it with a score: one batch, with
 * ids that come from the event, so that a resend of the batch is the same Statements.
 */
export async function sendCourse(
  client: LrsClient,
  learner: Agent,
  registration: string,
  times: readonly [string, string, string],
  extra: { readonly nameInIndonesian?: boolean } = {},
): Promise<Course> {
  const [launchedAt, answeredAt, completedAt] = times;
  const context = { registration };
  const launched = buildStatement({
    id: idOf("launched", learner, launchedAt),
    actor: learner,
    verb: VERBS.launched,
    object: COURSE,
    timestamp: launchedAt,
    context,
  });
  const answered = buildStatement({
    id: idOf("answered", learner, answeredAt),
    actor: learner,
    verb: VERBS.answered,
    object: QUESTION,
    timestamp: answeredAt,
    result: { response: "median", success: true },
    context,
  });
  const completed = buildStatement({
    id: idOf("completed", learner, completedAt),
    actor: learner,
    verb: VERBS.completed,
    object: extra.nameInIndonesian
      ? { id: STATISTICS, definition: { name: { "id-ID": "Statistika 101" } } }
      : { id: STATISTICS },
    timestamp: completedAt,
    result: { score: { scaled: 0.9, raw: 90, min: 0, max: 100 }, completion: true, duration: "PT1H30M" },
    context,
  });
  const ids = await client.sendStatements([launched, answered, completed]);
  return { ids, registration };
}

/** Sends a Statement that the platform got wrong, and then the Statement that voids it. Returns the id of the mistake. */
export async function voidMistake(client: LrsClient, learner: Agent, platform: Agent, at: string): Promise<string> {
  const mistake: Statement = buildStatement({
    id: idOf("mistaken", learner, at),
    actor: learner,
    verb: VERBS.completed,
    object: { id: "https://campus.example/courses/physics" },
    timestamp: at,
    result: { completion: true },
  });
  await client.sendStatements([mistake]);
  const voiding = buildVoidingStatement(mistake.id ?? "", {
    id: idOf("voiding", platform, at),
    actor: platform,
    timestamp: at,
  });
  await client.sendStatements([voiding]);
  return mistake.id ?? "";
}

/** The certificate that the platform issues: its text, which a file would hold. */
const CERTIFICATE = new TextEncoder().encode("Certificate of completion: Statistics 101");

/**
 * Sends a signed Statement that the learner earned a certificate, with the certificate as an Attachment: the Statement, the data
 * of the certificate and the data of the signature in one multipart request.
 */
export async function sendCertificate(client: LrsClient, learner: Agent, signer: Signer, at: string): Promise<string> {
  const statement = buildStatement({
    id: idOf("certificate", learner, at),
    actor: learner,
    verb: VERBS.earned,
    object: { id: "https://campus.example/certificates/statistics-101" },
    timestamp: at,
    attachments: [
      {
        usageType: "https://campus.example/attachments/certificate",
        display: { "en-US": "Certificate" },
        contentType: "text/plain",
        length: CERTIFICATE.byteLength,
        sha2: hashAttachment(CERTIFICATE),
      },
    ],
  });
  const signed = await signStatement(statement, signer);
  const data = { sha2: hashAttachment(CERTIFICATE), contentType: "text/plain", body: CERTIFICATE };
  await client.sendStatement(signed.statement, { attachments: [data, signed.signature] });
  return statement.id ?? "";
}

/** The place of the progress of a learner in the course. */
function progressOf(learner: Agent): DocumentTarget {
  return { resource: "state", activityId: STATISTICS, agent: learner, stateId: "progress" };
}

/** What a write of progress came to. */
export type Progress =
  | { readonly outcome: "written" | "precondition-failed" | "conflict"; readonly page: number }
  | { readonly outcome: "none" };

/**
 * Saves the page a learner reached: the document is created where none exists, and is replaced under the tag that was read, so
 * that a device that has an old copy does not overwrite a newer one.
 */
export async function saveProgress(client: LrsClient, learner: Agent, page: number, tag?: string): Promise<Progress> {
  const body = new TextEncoder().encode(JSON.stringify({ page }));
  const outcome = await client.putDocument(
    progressOf(learner),
    { contentType: "application/json", body },
    { precondition: tag === undefined ? { ifNoneMatch: "*" } : { ifMatch: tag } },
  );
  return { outcome, page };
}

/** Reads the progress of a learner with the tag that a later write needs. */
export async function readProgress(
  client: LrsClient,
  learner: Agent,
): Promise<{ readonly page: number; readonly tag: string } | undefined> {
  const found = await client.getDocument(progressOf(learner));
  if (found === undefined) return undefined;
  return { page: (JSON.parse(new TextDecoder().decode(found.body)) as { page: number }).page, tag: found.etag };
}
