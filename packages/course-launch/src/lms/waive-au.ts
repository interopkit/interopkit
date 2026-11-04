import { DataError, readClock } from "@interopkit/core";
import { isUuid, nonEmptyStringSchema, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { courseOf, registrationOf } from "./create-registration.js";
import { derivedId, waivedStatement } from "./lms-statements.js";
import { type LmsOptions, readLmsOptions, signalOf, withRetries } from "./options.js";
import { auOf } from "./progress.js";
import { satisfy, writeOnce } from "./satisfy.js";

/** What a host gives to waive an assignable unit for a learner. */
export interface WaiverInput {
  /** The registration of the learner. */
  readonly registration: string;
  /** The publisher id of the assignable unit. */
  readonly au: string;
  /** Why the LMS waives the unit, such as `Tested Out`, `Equivalent AU` or `Administrative` (9.5.5.2). */
  readonly reason: string;
}

const inputSchema = strictRecord({
  registration: v.pipe(
    v.string(),
    v.check(isUuid, (issue) => `expected a UUID, found ${issue.received}`),
  ),
  au: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
});

/**
 * Waives an assignable unit for a learner: writes the waived statement, which satisfies the unit, and the satisfied statements
 * of the blocks and the course that this satisfies.
 *
 * @remarks
 * The waived statement has success and completion, the reason, and a session id of its own that only the satisfied statements
 * it causes share (9.3.7). A unit is waived once per registration: its statement id is derived from the registration and the
 * unit, so a call made again after a failure writes it once, and a call for a unit that is waived already writes nothing.
 *
 * @param input - The registration, the unit and the reason.
 * @param options - The options of the LMS.
 * @returns `"waived"`, or `"already-waived"`.
 * @throws `DataError` for an input that is not valid, or a registration, course or unit that the store does not hold.
 * @throws What the store or the client of the LRS rejects with, and `InteropkitError` when the store keeps a conflict.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#verbs_waived | cmi5, 9.3.7 Waived}
 */
export async function waiveAu(input: WaiverInput, options: LmsOptions): Promise<"waived" | "already-waived"> {
  const settings = readLmsOptions(options);
  const read = parseWith(inputSchema, input, "The input of the waiver");
  const { store } = settings;
  const id = read.registration.toLowerCase();
  const registration = await registrationOf(settings, id);
  const course = await courseOf(settings, registration.course);
  const au = course.aus.find(({ publisherId }) => publisherId === read.au);
  if (au === undefined)
    throw new DataError(`The course ${course.id} has no assignable unit ${JSON.stringify(read.au)}.`);
  if (auOf(registration, au.publisherId).waived !== undefined) return "already-waived";
  const session = derivedId(course, "waiver", id, au.publisherId);
  const statement = waivedStatement(course, au, registration, read.reason, session, readClock(settings.clock));
  await writeOnce(settings, statement);
  return withRetries("waived an assignable unit", async () => {
    const current = await registrationOf(settings, id);
    const unit = auOf(current, au.publisherId);
    if (unit.waived !== undefined) return "already-waived";
    const waived = {
      ...current,
      aus: {
        ...current.aus,
        [au.publisherId]: {
          ...unit,
          waived: { statement: derivedId(course, "waived", id, au.publisherId), reason: read.reason },
        },
      },
    };
    const satisfied = await satisfy(settings, course, waived, session);
    const put = await store.putRegistration(
      { ...satisfied, revision: current.revision + 1 },
      current.revision,
      signalOf(settings),
    );
    return put === "written" ? "waived" : "conflict";
  });
}
