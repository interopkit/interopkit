import { DataError } from "@interopkit/core";
import { checkRecord } from "@interopkit/core/checks";
import type { MoveOn } from "../model/index.js";
import type { Satisfiable } from "./lms-statements.js";
import type { ImportedCourse, Registration, RegistrationAu } from "./records.js";

/** What a registration holds of a course: each assignable unit, each block and the course, satisfied or not. */
export interface CourseProgress {
  /** Whether the course is satisfied: every member in it is. */
  readonly satisfied: boolean;
  /** Each block in the order of the structure, by its publisher id. */
  readonly blocks: readonly {
    /** The publisher id of the block. */
    readonly id: string;
    /** Whether every member of the block is satisfied. */
    readonly satisfied: boolean;
  }[];
  /** Each assignable unit in the order of the structure, by its publisher id. */
  readonly aus: readonly {
    /** The publisher id of the unit. */
    readonly id: string;
    /** Whether the registration holds a completed statement that the LRS stored. */
    readonly completed: boolean;
    /** Whether the registration holds a passed statement that the LRS stored. */
    readonly passed: boolean;
    /** Whether the LMS waived the unit. */
    readonly waived: boolean;
    /** Whether the unit is satisfied: its `moveOn` is met, or it was waived. */
    readonly satisfied: boolean;
  }[];
}

/** Tells whether an assignable unit meets a criterion with the outcomes that the LRS stored (9.3, the table of moveOn). */
function meets(moveOn: MoveOn, completed: boolean, passed: boolean): boolean {
  switch (moveOn) {
    case "NotApplicable":
      return true;
    case "Passed":
      return passed;
    case "Completed":
      return completed;
    case "CompletedAndPassed":
      return completed && passed;
    case "CompletedOrPassed":
      return completed || passed;
  }
}

/** Tells whether an assignable unit is satisfied now: it was, it was waived, or its outcomes meet its `moveOn`. */
function isSatisfied(au: RegistrationAu): boolean {
  return (
    au.satisfied ||
    au.waived !== undefined ||
    meets(au.moveOn, au.completed?.stored === true, au.passed?.stored === true)
  );
}

/**
 * Returns the record of an assignable unit in a registration, which holds one for every unit of its course.
 *
 * @throws `DataError` when it holds none: the store returned another record than the LMS wrote.
 */
export function auOf(registration: Registration, id: string): RegistrationAu {
  const au = Object.hasOwn(registration.aus, id) ? registration.aus[id] : undefined;
  if (au === undefined) {
    throw new DataError(
      `The registration ${registration.id} holds no assignable unit ${JSON.stringify(id)}, which its course has: the store returned another record than the LMS wrote.`,
    );
  }
  return au;
}

/** The satisfaction of every member of a course, by publisher id: units by their record, blocks by their members. */
function satisfactionOf(course: ImportedCourse, registration: Registration): ReadonlyMap<string, boolean> {
  const satisfied = new Map<string, boolean>();
  for (const au of course.aus) satisfied.set(au.publisherId, isSatisfied(auOf(registration, au.publisherId)));
  // The blocks in reverse order of the structure: a block comes after the blocks it holds, so these are known first.
  for (const block of [...course.blocks].reverse()) {
    satisfied.set(
      block.publisherId,
      block.members.every((member) => satisfied.get(member) === true),
    );
  }
  return satisfied;
}

/**
 * Lists the blocks and the course that a registration satisfies and whose satisfied statement is not written: the blocks
 * innermost first, then the course (9.3.9).
 */
export function dueSatisfactions(course: ImportedCourse, registration: Registration): readonly Satisfiable[] {
  const satisfied = satisfactionOf(course, registration);
  const written = new Set(registration.satisfiedBlocks);
  const blocks = new Map(course.blocks.map((block) => [block.publisherId, block]));
  const due: Satisfiable[] = [];
  const visit = (members: readonly string[]): void => {
    for (const id of members) {
      const block = blocks.get(id);
      if (block === undefined) continue;
      visit(block.members);
      if (satisfied.get(id) === true && !written.has(id)) {
        due.push({ kind: "block", publisherId: id, lmsId: block.lmsId });
      }
    }
  };
  visit(course.members);
  if (!registration.satisfied && course.members.every((id) => satisfied.get(id) === true)) {
    due.push({ kind: "course", publisherId: course.publisherId, lmsId: course.lmsId });
  }
  return due;
}

/** Marks every assignable unit of a registration that is satisfied now. */
export function withSatisfiedUnits(registration: Registration): Registration {
  return {
    ...registration,
    aus: Object.fromEntries(
      Object.entries(registration.aus).map(([id, au]) => [id, isSatisfied(au) ? { ...au, satisfied: true } : au]),
    ),
  };
}

/** Records that the satisfied statements of the blocks and the course given are written. */
export function withSatisfactions(registration: Registration, written: readonly Satisfiable[]): Registration {
  return {
    ...registration,
    satisfiedBlocks: [
      ...registration.satisfiedBlocks,
      ...written.filter(({ kind }) => kind === "block").map(({ publisherId }) => publisherId),
    ],
    satisfied: registration.satisfied || written.some(({ kind }) => kind === "course"),
  };
}

/**
 * Tells what a registration holds of its course: for each assignable unit its stored completed and passed statements, whether
 * it was waived and whether it is satisfied, and for each block and the course whether every member in it is satisfied.
 *
 * @remarks
 * A host reads it to show progress and to decide what a learner may launch next, such as a block that needs another block
 * first. It reads the records alone and makes no call.
 *
 * @param registration - The registration, as the store holds it.
 * @param course - The course of the registration, as `importCourse` returned it.
 * @returns The progress, in the order of the structure.
 * @throws `DataError` when an argument is not an object.
 */
export function progressOf(registration: Registration, course: ImportedCourse): CourseProgress {
  checkRecord(registration, "The registration must be an object");
  checkRecord(course, "The course must be an object");
  const satisfied = satisfactionOf(course, registration);
  return {
    satisfied: course.members.every((id) => satisfied.get(id) === true),
    blocks: course.blocks.map(({ publisherId }) => ({
      id: publisherId,
      satisfied: satisfied.get(publisherId) === true,
    })),
    aus: course.aus.map(({ publisherId }) => {
      const au = auOf(registration, publisherId);
      return {
        id: publisherId,
        completed: au.completed?.stored === true,
        passed: au.passed?.stored === true,
        waived: au.waived !== undefined,
        satisfied: satisfied.get(publisherId) === true,
      };
    }),
  };
}
