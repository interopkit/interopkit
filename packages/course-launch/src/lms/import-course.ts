import { DataError } from "@interopkit/core";
import {
  describe,
  isAbsoluteUri,
  isUuid,
  nonEmptyStringSchema,
  parseWith,
  strictRecord,
} from "@interopkit/core/checks";
import { v5 } from "uuid";
import * as v from "valibot";
import type { AssignableUnit, Block, CourseStructure } from "../model/index.js";
import { readCourseStructure, writeCourseStructure } from "../structure/index.js";
import type { ImportedAu, ImportedBlock, ImportedCourse } from "./records.js";

/** What the host gives for an import: its id of the course, and where the ids of the LMS and the relative URLs start. */
export interface ImportInput {
  /** The id of the course in the host, by which the store finds it. */
  readonly courseId: string;
  /** The start of every id that the LMS makes, an IRI such as `https://lms.example.org/activities/`. */
  readonly idBase: string;
  /** The UUID under which the ids of the LMS and of its statements are made, the same for every import of the host. */
  readonly idNamespace: string;
  /**
   * The https or http address that the relative URLs of a ZIP package are resolved against: where the host serves its files,
   * ending in a slash.
   *
   * @defaultValue none: every URL must be fully qualified
   */
  readonly contentBase?: string;
}

const inputSchema = strictRecord({
  courseId: nonEmptyStringSchema,
  idBase: nonEmptyStringSchema,
  idNamespace: v.pipe(
    v.string(),
    v.check(isUuid, (issue) => `expected a UUID, found ${issue.received}`),
  ),
  contentBase: v.optional(
    v.pipe(
      v.string(),
      v.check(
        (text) => URL.canParse(text) && /^https?:$/u.test(new URL(text).protocol) && text.endsWith("/"),
        (issue) => `expected an https or http address that ends in a slash, found ${issue.received}`,
      ),
    ),
  ),
});

/** The kinds of what the LMS makes an id for, which the name of each id holds. */
type IdKind = "course" | "block" | "au";

/** What the walk of an import needs of its input. */
interface ImporterInput {
  readonly courseId: string;
  readonly idBase: string;
  readonly idNamespace: string;
  readonly contentBase: string | undefined;
}

/** Builds the lists of an import while it walks the members of the structure. */
class Importer {
  readonly aus: ImportedAu[] = [];
  readonly blocks: ImportedBlock[] = [];
  private readonly input: ImporterInput;
  private readonly publisherIds: ReadonlySet<string>;

  constructor(input: ImporterInput, publisherIds: ReadonlySet<string>) {
    this.input = input;
    this.publisherIds = publisherIds;
  }

  /**
   * Makes the id of the LMS for a member: the base, then a UUID of version 5 of the course, the kind and the publisher id.
   *
   * @throws `DataError` when the id is no IRI, or is a publisher id of the structure.
   */
  lmsId(kind: IdKind, publisherId: string): string {
    const { courseId, idBase, idNamespace } = this.input;
    const id = `${idBase}${v5(JSON.stringify([courseId, kind, publisherId]), idNamespace)}`;
    if (!isAbsoluteUri(id)) {
      throw new DataError(`The input idBase must start a fully qualified IRI, found ${describe(idBase)}.`);
    }
    // The ids of the LMS must differ from those of the publisher (8.1.5, 9.3.9).
    if (this.publisherIds.has(id)) {
      throw new DataError(`The id ${describe(id)} that the LMS made is a publisher id of the course structure.`);
    }
    return id;
  }

  /** Resolves the URL of an assignable unit against the content base when it is relative. */
  url(au: AssignableUnit): string {
    if (URL.canParse(au.url)) return au.url;
    if (this.input.contentBase === undefined) {
      throw new DataError(
        `The assignable unit ${describe(au.id)} has the relative URL ${describe(au.url)}, and the input has no contentBase to resolve it against.`,
      );
    }
    return new URL(au.url, this.input.contentBase).href;
  }

  /** Adds the members of a list, held by the blocks given, the innermost first. */
  members(list: readonly (AssignableUnit | Block)[], blocks: readonly string[]): void {
    for (const member of list) {
      if (member.kind === "au") this.au(member, blocks);
      else this.block(member, blocks);
    }
  }

  private au(au: AssignableUnit, blocks: readonly string[]): void {
    this.aus.push({
      publisherId: au.id,
      lmsId: this.lmsId("au", au.id),
      url: this.url(au),
      launchMethod: au.launchMethod,
      moveOn: au.moveOn,
      ...(au.masteryScore === undefined ? {} : { masteryScore: au.masteryScore }),
      ...(au.launchParameters === undefined ? {} : { launchParameters: au.launchParameters }),
      ...(au.entitlementKey === undefined ? {} : { entitlementKey: au.entitlementKey }),
      blocks,
    });
  }

  private block(block: Block, blocks: readonly string[]): void {
    this.blocks.push({
      publisherId: block.id,
      lmsId: this.lmsId("block", block.id),
      members: block.children.map(({ id }) => id),
      blocks,
    });
    this.members(block.children, [block.id, ...blocks]);
  }
}

/** Lists every publisher id of a structure: the course, its objectives, blocks and assignable units. */
function publisherIdsOf(structure: CourseStructure): ReadonlySet<string> {
  const ids = new Set([structure.course.id, ...structure.objectives.map(({ id }) => id)]);
  const walk = (list: readonly (AssignableUnit | Block)[]): void => {
    for (const member of list) {
      ids.add(member.id);
      if (member.kind === "block") walk(member.children);
    }
  };
  walk(structure.children);
  return ids;
}

/**
 * Imports a course structure into the LMS: checks it, and makes the ids of the LMS for the course, its blocks and its
 * assignable units, the same at every import of the course.
 *
 * @remarks
 * The structure is checked as `writeCourseStructure` checks it, by every rule of `readCourseStructure`, and copied. The id of
 * the LMS for a member is `idBase` followed by a UUID of version 5, under `idNamespace`, of the course id of the host, the kind
 * of the member and its publisher id: the same in every registration, and never the publisher id (8.1.5, 9.3.9). A relative URL
 * of a ZIP package is resolved against `contentBase`. The host keeps what this returns in its `Cmi5Store`, by `courseId`.
 *
 * @param structure - The course structure, such as `readCourseStructure` or `readCoursePackage` returns.
 * @param input - The course id of the host, the base and the namespace of the ids, and the base of relative URLs.
 * @returns The imported course, a copy that shares nothing with the input.
 * @throws `DataError` that names the fault: a structure that a rule of cmi5 refuses, a relative URL without `contentBase`, or
 * an input that is not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#launch_method_activityid | cmi5, 8.1.5 activityId}
 */
export function importCourse(structure: CourseStructure, input: ImportInput): ImportedCourse {
  const read = parseWith(inputSchema, input, "The input of the import");
  const checked = readCourseStructure(writeCourseStructure(structure), { packaged: true });
  const importer = new Importer(
    { courseId: read.courseId, idBase: read.idBase, idNamespace: read.idNamespace, contentBase: read.contentBase },
    publisherIdsOf(checked),
  );
  const lmsId = importer.lmsId("course", checked.course.id);
  importer.members(checked.children, []);
  return {
    id: read.courseId,
    idNamespace: read.idNamespace.toLowerCase(),
    publisherId: checked.course.id,
    lmsId,
    members: checked.children.map(({ id }) => id),
    aus: importer.aus,
    blocks: importer.blocks,
    structure: checked,
  };
}
