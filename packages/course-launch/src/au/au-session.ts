import { type CallOptions, DataError, readClock, ServiceError } from "@interopkit/core";
import { checkRecord, isUuid } from "@interopkit/core/checks";
import {
  type Attachment,
  buildStatement,
  CONTEXT_ACTIVITY_TYPES,
  type Context,
  type DocumentTarget,
  type Extensions,
  formatDuration,
  formatTimestamp,
  type LrsDocument,
  type LrsDocumentInput,
  type Result,
  type Score,
  type Statement,
  type StatementObject,
  type Verb,
} from "@interopkit/learning-records";
import type { LrsClient, WriteOutcome } from "@interopkit/learning-records/client";
import {
  CMI5_CATEGORIES,
  CMI5_EXTENSIONS,
  CMI5_VERBS,
  type Cmi5Verb,
  LAUNCH_DATA_STATE_ID,
  type LaunchData,
  type LaunchParameters,
  LEARNER_PREFERENCES_PROFILE_ID,
  type LearnerPreferences,
} from "../model/index.js";
import { writeLearnerPreferences } from "../rules/index.js";
import { judgeStatement, type SessionProgress } from "../rules/internal.js";
import type { AuResume, AuSettings, AuVerb } from "./options.js";
import { signalOf } from "./options.js";

/** What a statement came to: sent and stored, skipped because the rules or the launch mode forbid it, or refused by the LMS. */
export type Recorded = "recorded" | "skipped" | "refused";

/** What the registration held for the unit when its session started. */
export interface PriorOutcome {
  /** Whether the registration holds a completed statement of the unit. */
  readonly completed: boolean;
  /** Whether the registration holds a passed statement of the unit. */
  readonly passed: boolean;
  /**
   * The waiver of the unit and its reason, when the LMS waived it.
   *
   * @defaultValue none
   */
  readonly waived?: { readonly reason: string };
}

/** What a completed, passed or failed statement may carry beyond what the session gives it. */
export interface OutcomeOptions extends CallOptions {
  /**
   * The time the learner spent, in milliseconds.
   *
   * @defaultValue the time since the initialized statement
   */
  readonly durationMs?: number;
}

/** A statement that cmi5 allows, which the session completes with the actor, the template and the time. */
export interface AllowedStatementInput {
  /**
   * The id, a UUID, so that a call made again after a failure sends the same statement.
   *
   * @defaultValue a new UUID
   */
  readonly id?: string;
  /** The verb, any but those of cmi5. */
  readonly verb: Verb;
  /**
   * The object.
   *
   * @defaultValue the activity of the unit
   */
  readonly object?: StatementObject;
  /**
   * The result.
   *
   * @defaultValue none
   */
  readonly result?: Result;
  /**
   * What the statement adds to the context of the template: its activities and extensions are joined to those of the template.
   *
   * @defaultValue none
   */
  readonly context?: Context;
  /**
   * The headers of the Attachments of the statement.
   *
   * @defaultValue none
   */
  readonly attachments?: readonly Attachment[];
}

/** The session of an assignable unit, which `startAuSession` returns. */
export interface AuSession {
  /** The parameters of the launch URL. */
  readonly launch: LaunchParameters;
  /** The `LMS.LaunchData` of the session. */
  readonly launchData: LaunchData;
  /** The preferences of the learner, empty when the LMS holds none. */
  readonly preferences: LearnerPreferences;
  /** What the registration held at start: completed, passed, waived and its reason. */
  readonly prior: PriorOutcome;
  /** What the page keeps for a reload: serializable, given again as the option `resume`. */
  readonly resume: AuResume;
  /** Sends the initialized statement, the first of the session. */
  initialize(options?: CallOptions): Promise<Recorded>;
  /** Sends the completed statement, with its duration. */
  complete(options?: OutcomeOptions): Promise<Recorded>;
  /** Sends the passed statement, with its duration and the score when given. */
  pass(score?: Score, options?: OutcomeOptions): Promise<Recorded>;
  /** Sends the failed statement, with its duration and the score when given. */
  fail(score?: Score, options?: OutcomeOptions): Promise<Recorded>;
  /** Sends passed or failed by the mastery score of the launch, which the scaled score meets or does not. */
  judge(score: Score, options?: OutcomeOptions): Promise<Recorded>;
  /** Sends an allowed statement with the progress of the learner, an integer from 0 to 100. */
  progress(percent: number, options?: CallOptions): Promise<Recorded>;
  /** Sends a statement that cmi5 allows, with the template of the session. */
  send(statement: AllowedStatementInput, options?: CallOptions): Promise<Recorded>;
  /** The State documents of the unit for its learner in its registration. */
  readonly state: {
    /** Fetches a document, or resolves `undefined` when there is none. */
    get(stateId: string, options?: CallOptions): Promise<LrsDocument | undefined>;
    /** Replaces a document, or makes it. */
    put(stateId: string, document: LrsDocumentInput, options?: CallOptions): Promise<WriteOutcome>;
  };
  /** Writes the preferences of the learner; an LMS may refuse them with 403, which is no error (11.0). */
  savePreferences(preferences: Required<LearnerPreferences>, options?: CallOptions): Promise<"saved" | "refused">;
  /** Sends the terminated statement, the last of the session, and returns where the page sends the learner next. */
  terminate(options?: CallOptions): Promise<{ readonly returnUrl?: string }>;
}

/** What a session is made from. */
interface SessionParts {
  readonly settings: AuSettings;
  readonly launch: LaunchParameters;
  readonly launchData: LaunchData;
  readonly preferences: LearnerPreferences;
  readonly prior: PriorOutcome;
  readonly client: LrsClient;
  readonly token: string;
}

/** The version of xAPI that cmi5 names, whose rules the statements of the unit follow. */
const XAPI_VERSION = { version: "1.0.3" } as const;

/** The verb of the statement that carries the progress of the learner, from the registry of ADL. */
const PROGRESSED: Verb = { id: "http://adlnet.gov/expapi/verbs/progressed", display: { "en-US": "progressed" } };

/** The most that `progress` may say, a percentage (9.5.5.1). */
const MAX_PROGRESS = 100;

/** The verbs of cmi5 that a unit sends, which its resume lists. */
const AU_VERBS: ReadonlySet<string> = new Set(["initialized", "completed", "passed", "failed", "terminated"]);

/** The statuses with which an LMS refuses a request of a unit: an ended token, and a request that cmi5 refuses. */
const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** Tells whether a return URL is one that a page may open: http or https (10.2.6). */
function isPageUrl(url: string | undefined): url is string {
  return url !== undefined && URL.canParse(url) && /^https?:$/u.test(new URL(url).protocol);
}

/** Builds what a session tracks as it goes, from what the registration held and what it sent before a reload. */
function progressFrom(prior: PriorOutcome, resume: AuResume | undefined): SessionProgress {
  const verbs = resume?.sent ?? [];
  return {
    initializedAt: resume?.initializedAt,
    terminated: verbs.includes("terminated"),
    verbs,
    completed: prior.completed || verbs.includes("completed"),
    passed: prior.passed || verbs.includes("passed"),
  };
}

/** Makes the session of a unit: it judges each statement by the rules of cmi5 before it sends it. */
export function createAuSession(parts: SessionParts): AuSession {
  const { settings, launch, launchData, preferences, prior, client, token } = parts;
  const facts = {
    actor: launch.actor,
    registration: launch.registration,
    activityId: launch.activityId,
    launchData,
    prior: { completed: prior.completed, passed: prior.passed },
    preferencesRead: true,
  };
  let progress = progressFrom(prior, settings.resume);
  let ended = settings.resume?.ended ?? false;
  // A statement whose request failed waits here under its kind, so that the next call sends it again with its id (9.1).
  const pending = new Map<string, Statement>();

  const now = (): number => readClock(settings.clock);
  const durationOf = (options: OutcomeOptions | undefined): string =>
    formatDuration(options?.durationMs ?? Math.max(0, now() - (progress.initializedAt ?? now())));

  /**
   * The context of a statement: every value of the template, which no statement may change (10.2.1), with the registration,
   * the activities and extensions that the statement adds, and the categories given.
   */
  const contextOf = (categories: readonly string[], extensions: Extensions, added?: Context): Context => {
    const template = launchData.contextTemplate;
    const contextActivities = Object.fromEntries(
      CONTEXT_ACTIVITY_TYPES.flatMap((type) => {
        const list = [
          ...(template.contextActivities?.[type] ?? []),
          ...(added?.contextActivities?.[type] ?? []),
          ...(type === "category" ? categories.map((id) => ({ id })) : []),
        ];
        return list.length === 0 ? [] : [[type, list] as const];
      }),
    );
    return {
      ...added,
      ...template,
      registration: launch.registration,
      contextActivities,
      extensions: { ...added?.extensions, ...extensions, ...template.extensions },
    };
  };

  /** Builds a statement that cmi5 defines, with the moveOn category when it carries success or completion. */
  const defined = (verb: Cmi5Verb, result?: Result, mastery = false): Statement => {
    const judged = result?.success !== undefined || result?.completion !== undefined;
    const extensions: Extensions =
      mastery && launchData.masteryScore !== undefined
        ? { [CMI5_EXTENSIONS.masteryScore]: launchData.masteryScore }
        : {};
    return buildStatement(
      {
        id: crypto.randomUUID(),
        actor: launch.actor,
        verb: { id: CMI5_VERBS[verb], display: { "en-US": verb } },
        object: { objectType: "Activity", id: launch.activityId },
        ...(result === undefined ? {} : { result }),
        context: contextOf([CMI5_CATEGORIES.cmi5, ...(judged ? [CMI5_CATEGORIES.moveOn] : [])], extensions),
        timestamp: formatTimestamp(now()),
      },
      XAPI_VERSION,
    );
  };

  /** Judges a statement by the rules of the session, sends it when they allow it, and says what came of it. */
  const record = async (key: string, build: () => Statement, options: CallOptions | undefined): Promise<Recorded> => {
    if (ended) return "skipped";
    const statement = pending.get(key) ?? build();
    const judged = judgeStatement(statement, facts, progress);
    if (judged.findings.some(({ severity }) => severity === "error")) {
      pending.delete(key);
      return "skipped";
    }
    pending.set(key, statement);
    let outcome: "stored" | "conflict";
    try {
      outcome = await client.sendStatement(statement, signalOf(settings, options));
    } catch (error) {
      if (!(error instanceof ServiceError && REFUSED_STATUSES.has(error.status))) throw error;
      pending.delete(key);
      ended = ended || error.status === 401;
      return "refused";
    }
    pending.delete(key);
    if (outcome === "conflict") return "refused";
    progress = judged.next;
    return "recorded";
  };

  /** The target of a State document of the unit. */
  const stateTarget = (stateId: string): DocumentTarget => ({
    resource: "state",
    activityId: launch.activityId,
    agent: launch.actor,
    registration: launch.registration,
    stateId,
  });

  const judgedBy = (verb: "passed" | "failed", score: Score | undefined, options: OutcomeOptions | undefined) =>
    record(
      verb,
      () =>
        defined(
          verb,
          { success: verb === "passed", duration: durationOf(options), ...(score === undefined ? {} : { score }) },
          true,
        ),
      options,
    );

  return {
    launch,
    launchData,
    preferences,
    prior,
    get resume(): AuResume {
      return {
        registration: launch.registration,
        activityId: launch.activityId,
        token,
        ...(progress.initializedAt === undefined ? {} : { initializedAt: progress.initializedAt }),
        sent: progress.verbs.filter((verb): verb is AuVerb => AU_VERBS.has(verb)),
        ended,
      };
    },
    initialize: (options) => record("initialized", () => defined("initialized"), options),
    complete: (options) =>
      record("completed", () => defined("completed", { completion: true, duration: durationOf(options) }), options),
    pass: (score, options) => judgedBy("passed", score, options),
    fail: (score, options) => judgedBy("failed", score, options),
    judge: (score, options) => {
      checkRecord(score, "The score must be an object");
      const mastery = launchData.masteryScore;
      if (mastery === undefined) {
        throw new DataError("The launch has no masteryScore to judge a score by: send pass or fail.");
      }
      if (typeof score.scaled !== "number")
        throw new DataError("The score must have a scaled score to judge by the masteryScore.");
      return judgedBy(score.scaled >= mastery ? "passed" : "failed", score, options);
    },
    progress: (percent, options) => {
      if (!(Number.isInteger(percent) && percent >= 0 && percent <= MAX_PROGRESS)) {
        throw new DataError(`The progress must be an integer from 0 to 100, found ${JSON.stringify(percent)}.`);
      }
      const build = () =>
        buildStatement(
          {
            id: crypto.randomUUID(),
            actor: launch.actor,
            verb: PROGRESSED,
            object: { objectType: "Activity", id: launch.activityId },
            result: { extensions: { [CMI5_EXTENSIONS.progress]: percent } },
            context: contextOf([], {}),
            timestamp: formatTimestamp(now()),
          },
          XAPI_VERSION,
        );
      return record(`progress-${percent}`, build, options);
    },
    send: (input, options) => {
      checkRecord(input, "The statement must be an object");
      if (input.id !== undefined && (typeof input.id !== "string" || !isUuid(input.id))) {
        throw new DataError(`The id of the statement must be a UUID, found ${JSON.stringify(input.id)}.`);
      }
      const id = input.id ?? crypto.randomUUID();
      const build = () =>
        buildStatement(
          {
            id,
            actor: launch.actor,
            verb: input.verb,
            object: input.object ?? { objectType: "Activity", id: launch.activityId },
            ...(input.result === undefined ? {} : { result: input.result }),
            context: contextOf([], {}, input.context),
            ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
            timestamp: formatTimestamp(now()),
          },
          XAPI_VERSION,
        );
      return record(`send-${id}`, build, options);
    },
    state: {
      get: (stateId, options) => client.getDocument(stateTarget(stateId), signalOf(settings, options)),
      put: (stateId, document, options) => {
        if (stateId === LAUNCH_DATA_STATE_ID)
          throw new DataError("An assignable unit does not change LMS.LaunchData (10.2.1).");
        return client.putDocument(stateTarget(stateId), document, signalOf(settings, options));
      },
    },
    savePreferences: async (written, options) => {
      const body = new TextEncoder().encode(JSON.stringify(writeLearnerPreferences(written)));
      const target: DocumentTarget = {
        resource: "agent-profile",
        agent: launch.actor,
        profileId: LEARNER_PREFERENCES_PROFILE_ID,
      };
      try {
        const current = await client.getDocument(target, signalOf(settings, options));
        const precondition = current === undefined ? { ifNoneMatch: "*" as const } : { ifMatch: current.etag };
        const put = await client.putDocument(
          target,
          { contentType: "application/json", body },
          {
            precondition,
            ...signalOf(settings, options),
          },
        );
        return put === "written" ? "saved" : "refused";
      } catch (error) {
        if (error instanceof ServiceError && error.status === 403) return "refused";
        throw error;
      }
    },
    terminate: async (options) => {
      await record("terminated", () => defined("terminated", { duration: durationOf(undefined) }), options);
      return isPageUrl(launchData.returnUrl) ? { returnUrl: launchData.returnUrl } : {};
    },
  };
}
