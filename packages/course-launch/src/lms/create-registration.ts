import { DataError } from "@interopkit/core";
import { isUuid, nonEmptyStringSchema, parseWith, strictRecord } from "@interopkit/core/checks";
import { type Agent, isSameActor } from "@interopkit/learning-records";
import * as v from "valibot";
import { checkXapiPart } from "../rules/internal.js";
import { derivedId } from "./lms-statements.js";
import { type LmsOptions, type LmsSettings, newIdOf, readLmsOptions, signalOf } from "./options.js";
import type { ImportedCourse, Registration } from "./records.js";
import { satisfy } from "./satisfy.js";

/** What a host gives to register a learner in a course. */
export interface RegistrationInput {
  /** The id of the course that the host imported. */
  readonly courseId: string;
  /** The learner: an Agent with an account, as cmi5 identifies the learner (9.2). */
  readonly actor: Agent;
  /**
   * The registration, a UUID that the host made.
   *
   * @defaultValue a new one from `newId`
   */
  readonly registration?: string;
}

const inputSchema = strictRecord({
  courseId: nonEmptyStringSchema,
  actor: v.unknown(),
  registration: v.optional(
    v.pipe(
      v.string(),
      v.check(isUuid, (issue) => `expected a UUID, found ${issue.received}`),
    ),
  ),
});

/**
 * Reads the learner of a registration: an Agent with an account by the rules of xAPI 1.0.3.
 *
 * @throws `DataError` that names the fault.
 */
function readLearner(value: unknown, label: string): Agent {
  checkXapiPart("actor", value, label);
  // The rules of xAPI took it as an Actor.
  const actor = value as Agent;
  if ((actor.objectType ?? "Agent") !== "Agent" || actor.account === undefined) {
    throw new DataError(`${label} must be an Agent with an account, as cmi5 identifies the learner (9.2).`);
  }
  return structuredClone(actor);
}

/** Reads a course from the store, which must hold it. */
export async function courseOf(settings: LmsSettings, id: string): Promise<ImportedCourse> {
  const course = await settings.store.course(id, signalOf(settings));
  if (course === undefined) throw new DataError(`The store holds no course ${JSON.stringify(id)}.`);
  return course;
}

/** Reads a registration from the store, which must hold it. */
export async function registrationOf(settings: LmsSettings, id: string): Promise<Registration> {
  const registration = await settings.store.registration(id, signalOf(settings));
  if (registration === undefined) throw new DataError(`The store holds no registration ${id}.`);
  return registration;
}

/** Returns a registration that the store holds already, when it is the same learner in the same course. */
function sameRegistration(held: Registration, courseId: string, actor: Agent): Registration {
  if (held.course !== courseId || !isSameActor(held.actor, actor)) {
    throw new DataError(`The registration ${held.id} exists already, for another learner or another course.`);
  }
  return held;
}

/**
 * Registers a learner in a course: makes the registration, judges every assignable unit by its `moveOn` at once, and writes the
 * satisfied statements of the blocks and the course that this satisfies.
 *
 * @remarks
 * A unit whose `moveOn` is `NotApplicable` is satisfied at registration, and so is a block or a course whose members all are;
 * their satisfied statements carry a session id of the registration (9.6.1.1). The statements are written before the record,
 * with ids derived from what they are, so a call made again after a failure writes each once. A registration that the store
 * holds already for the same learner and course is returned as it is.
 *
 * @param input - The course, the learner and, when the host made it, the registration.
 * @param options - The options of the LMS.
 * @returns The registration, as the store holds it.
 * @throws `DataError` for an input that is not valid, a course that the store does not hold, or a registration that exists for
 * another learner or course.
 * @throws What the store or the client of the LRS rejects with, and `InteropkitError` when the store keeps a conflict.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#registration | cmi5, 9.6.1.1 Registration}
 */
export async function createRegistration(input: RegistrationInput, options: LmsOptions): Promise<Registration> {
  const settings = readLmsOptions(options);
  const read = parseWith(inputSchema, input, "The input of the registration");
  const actor = readLearner(read.actor, "The actor of the registration");
  const course = await courseOf(settings, read.courseId);
  const id = read.registration?.toLowerCase() ?? newIdOf(settings);
  const { store } = settings;
  const held = await store.registration(id, signalOf(settings));
  if (held !== undefined) return sameRegistration(held, read.courseId, actor);
  const fresh: Registration = {
    id,
    course: course.id,
    actor,
    revision: 1,
    aus: Object.fromEntries(course.aus.map((au) => [au.publisherId, { moveOn: au.moveOn, satisfied: false }])),
    satisfiedBlocks: [],
    satisfied: false,
  };
  const record = await satisfy(settings, course, fresh, derivedId(course, "registration", id));
  if ((await store.putRegistration(record, "absent", signalOf(settings))) === "written") return record;
  const won = await store.registration(id, signalOf(settings));
  if (won === undefined) throw new DataError(`The store refused the registration ${id} as a conflict and holds none.`);
  return sameRegistration(won, read.courseId, actor);
}
