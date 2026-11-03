import { checkFunction, checkRecord, parseWith } from "@interopkit/core/checks";
import { basePathSchema } from "@interopkit/core/http";
import type { LrsOptions, StatementStore } from "@interopkit/learning-records/store";
import { acceptStatements } from "./accept-statements.js";
import { afterStore } from "./after-store.js";
import { decideAccess } from "./au-access.js";
import { type LmsOptions, type LmsSettings, readLmsOptions, signalOf } from "./options.js";

/** Wraps the store of Statements of the host: what it stores goes through `afterStore` before the LRS answers. */
function wrapStatements(host: StatementStore, settings: LmsSettings): StatementStore {
  return {
    async insert(batch, voids, attachments, options) {
      const result = await host.insert(batch, voids, attachments, options);
      // An empty `existing` means the batch is stored; otherwise the store held these, and nothing of the batch is new.
      const stored = result.existing.length === 0 ? batch : result.existing;
      await afterStore(
        settings,
        stored.map(({ statement }) => statement),
      );
      return result;
    },
    get: (id, options) => host.get(id, options),
    query: (query, page, options) => host.query(query, page, options),
    consistentThrough: (options) => host.consistentThrough(options),
    attachments: (hashes, options) => host.attachments(hashes, options),
  };
}

/**
 * Makes the options of the host's LRS the LRS of a cmi5 LMS: requests with the token of a session are judged by the rules of
 * cmi5, and what an assignable unit stores satisfies its unit, blocks and course.
 *
 * @remarks
 * The options returned keep everything of the host's and change four things. `access` decides a request with the token of a
 * session itself: 401 for a token that is not, or no longer, that of an active session, 403 for what cmi5 does not let a unit
 * do, and otherwise the actions of the request with the session as its `principal`; every other request goes to the host's
 * `access`. `accept` judges the Statements of a unit against its session and reserves them, and leaves those of the host's
 * credentials to the host's `accept`. `acceptStatus` is 403, the status that cmi5 expects for a statement that it refuses. The
 * `insert` of the store of Statements, once the store took a batch or found it held already, records the outcomes that units
 * reserved, writes the satisfied statements that they make due through `records`, and ends a session at its terminated
 * statement, before the LRS answers; a failure there answers 500 with the Statements stored, and the unit's resend runs it
 * again.
 *
 * What a unit may do with its token: write Statements; read the Statements of its registration, and none by id; read and write
 * the State of its learner in its registration, but never change `LMS.LaunchData` or remove every document of an activity; read
 * and write the Agent Profile of its learner, the preferences only as a valid document and never removed, or only read under
 * `learnerPreferences: "read-only"`; read the Agents resource for its learner, the Activities, and read and write Activity
 * Profiles.
 *
 * @param lrs - The host's options of `handleLrsRequest`: its stores and its `access` for its own credentials.
 * @param options - The options of the LMS.
 * @returns The options to pass to `handleLrsRequest`.
 * @throws `DataError` when the options are not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#lms_requirements | cmi5, 6.0 LMS Requirements}
 */
export function extendLrsOptions(lrs: LrsOptions, options: LmsOptions): LrsOptions {
  const settings = readLmsOptions(options);
  checkRecord(lrs, "The options of the LRS must be an object");
  checkRecord(lrs.statements, "The option statements of the LRS must be an object");
  checkFunction(lrs.access, "The option access of the LRS must be a function");
  const host = lrs;
  // The router of the LRS compares the base path in the form of the path of a request, and so does the access of a unit.
  const basePath = parseWith(basePathSchema, host.basePath ?? "/xapi", "The option basePath of the LRS");
  const scope = { access: host.access, basePath };
  return {
    ...host,
    statements: wrapStatements(host.statements, settings),
    access: (request, call) => decideAccess(request, settings, scope, call),
    accept: async (statements, access, call) => {
      // A principal that names a session is the token of a unit; any other is the host's own.
      const { principal } = access;
      const session = principal === undefined ? undefined : await settings.store.session(principal, signalOf(settings));
      if (session !== undefined) return acceptStatements(settings, statements, session.id, host.statements);
      return host.accept === undefined ? [] : host.accept(statements, access, call);
    },
    acceptStatus: 403,
  };
}
