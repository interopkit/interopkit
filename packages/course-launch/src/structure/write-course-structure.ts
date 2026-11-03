import { DataError } from "@interopkit/core";
import { finiteSchema, isRecord, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  type AssignableUnit,
  type Block,
  COURSE_STRUCTURE_NAMESPACE,
  type CourseStructure,
  type ExtensionElement,
  LAUNCH_METHODS,
  type LangString,
  MOVE_ON_VALUES,
} from "../model/index.js";
import { checkExtensionElement } from "./extension.js";
import {
  type CourseWriteOptions,
  courseWriteEntries,
  DEFAULT_MAX_STRUCTURE_DEPTH,
  readCourseReadOptions,
} from "./options.js";
import { readStructureWith } from "./read-course-structure.js";

/** The characters that XML 1.0 holds: no control character but tab, line feed and carriage return, and no lone surrogate. */
const XML_CHARACTERS = /^[\t\n\r -퟿-�\u{10000}-\u{10FFFF}]*$/u;

const xmlTextSchema = v.pipe(
  v.string(),
  v.regex(XML_CHARACTERS, "expected text that XML 1.0 can hold, without control characters or lone surrogates"),
);

const langStringsSchema = v.array(strictRecord({ lang: v.optional(xmlTextSchema), text: xmlTextSchema }));

const extensionsSchema = v.array(strictRecord({ namespace: v.string(), name: v.string(), xml: v.string() }));

const unitSchema = strictRecord({
  kind: v.literal("au"),
  id: xmlTextSchema,
  title: langStringsSchema,
  description: langStringsSchema,
  objectives: v.array(xmlTextSchema),
  url: xmlTextSchema,
  launchMethod: v.picklist(LAUNCH_METHODS),
  moveOn: v.picklist(MOVE_ON_VALUES),
  masteryScore: v.optional(finiteSchema),
  activityType: v.optional(xmlTextSchema),
  launchParameters: v.optional(xmlTextSchema),
  entitlementKey: v.optional(xmlTextSchema),
  extensions: extensionsSchema,
});

const blockSchema: v.GenericSchema<unknown, Block> = strictRecord({
  kind: v.literal("block"),
  id: xmlTextSchema,
  title: langStringsSchema,
  description: langStringsSchema,
  objectives: v.array(xmlTextSchema),
  children: v.array(v.lazy(() => memberSchema)),
  extensions: extensionsSchema,
});

/** A member by its `kind`, so that the path of an issue goes into the member that the value says it is. */
const memberSchema: v.GenericSchema<unknown, AssignableUnit | Block> = v.lazy((input) =>
  isRecord(input) && input.kind === "block" ? blockSchema : unitSchema,
);

const structureSchema = strictRecord({
  course: strictRecord({
    id: xmlTextSchema,
    title: langStringsSchema,
    description: langStringsSchema,
    extensions: extensionsSchema,
  }),
  objectives: v.array(strictRecord({ id: xmlTextSchema, title: langStringsSchema, description: langStringsSchema })),
  children: v.array(memberSchema),
  extensions: extensionsSchema,
});

const writeOptionsSchema = strictRecord(courseWriteEntries);

/** The levels of blocks in blocks that the writer checks before the schema reads them, which it does by recursion. */
const MAX_BLOCK_LEVELS = DEFAULT_MAX_STRUCTURE_DEPTH;

/** Refuses blocks nested deeper than a structure may be, before a reader that recurses meets them. */
function checkNesting(structure: unknown): void {
  let level: unknown[] = [structure];
  for (let depth = 0; level.length > 0; depth += 1) {
    if (depth > MAX_BLOCK_LEVELS) {
      throw new DataError(
        `The course structure nests blocks more than ${MAX_BLOCK_LEVELS} deep, the most that it may.`,
      );
    }
    level = level.flatMap((member) => (isRecord(member) && Array.isArray(member.children) ? member.children : []));
  }
}

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");

const escapeAttribute = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");

/** Writes attributes, those whose value is `undefined` left out. */
function attributes(values: Readonly<Record<string, string | undefined>>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

/** Writes the XML of a course structure line by line, each line indented by its level. */
class StructureWriter {
  readonly lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];

  line(level: number, text: string): void {
    this.lines.push(`${"  ".repeat(level)}${text}`);
  }

  texts(level: number, name: string, texts: readonly LangString[]): void {
    this.line(level, `<${name}>`);
    for (const { lang, text } of texts) {
      this.line(level + 1, `<langstring${attributes({ lang })}>${escapeText(text)}</langstring>`);
    }
    this.line(level, `</${name}>`);
  }

  extensions(level: number, extensions: readonly ExtensionElement[]): void {
    for (const extension of extensions) this.line(level, extension.xml);
  }

  references(level: number, ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.line(level, "<objectives>");
    for (const id of ids) this.line(level + 1, `<objective${attributes({ idref: id })}/>`);
    this.line(level, "</objectives>");
  }

  optionalText(level: number, name: string, text: string | undefined): void {
    if (text !== undefined) this.line(level, `<${name}>${escapeText(text)}</${name}>`);
  }

  member(level: number, member: AssignableUnit | Block): void {
    if (member.kind === "block") {
      this.line(level, `<block${attributes({ id: member.id })}>`);
      this.texts(level + 1, "title", member.title);
      this.texts(level + 1, "description", member.description);
      this.references(level + 1, member.objectives);
      for (const child of member.children) this.member(level + 1, child);
      this.extensions(level + 1, member.extensions);
      this.line(level, "</block>");
      return;
    }
    const { id, moveOn, launchMethod, masteryScore, activityType } = member;
    const score = masteryScore === undefined ? undefined : String(masteryScore);
    this.line(level, `<au${attributes({ id, moveOn, masteryScore: score, launchMethod, activityType })}>`);
    this.texts(level + 1, "title", member.title);
    this.texts(level + 1, "description", member.description);
    this.references(level + 1, member.objectives);
    this.line(level + 1, `<url>${escapeText(member.url)}</url>`);
    this.optionalText(level + 1, "launchParameters", member.launchParameters);
    this.optionalText(level + 1, "entitlementKey", member.entitlementKey);
    this.extensions(level + 1, member.extensions);
    this.line(level, "</au>");
  }

  structure(structure: CourseStructure): string {
    const { course, objectives } = structure;
    this.line(0, `<courseStructure${attributes({ xmlns: COURSE_STRUCTURE_NAMESPACE })}>`);
    this.line(1, `<course${attributes({ id: course.id })}>`);
    this.texts(2, "title", course.title);
    this.texts(2, "description", course.description);
    this.extensions(2, course.extensions);
    this.line(1, "</course>");
    if (objectives.length > 0) {
      this.line(1, "<objectives>");
      for (const objective of objectives) {
        this.line(2, `<objective${attributes({ id: objective.id })}>`);
        this.texts(3, "title", objective.title);
        this.texts(3, "description", objective.description);
        this.line(2, "</objective>");
      }
      this.line(1, "</objectives>");
    }
    for (const member of structure.children) this.member(1, member);
    this.extensions(1, structure.extensions);
    this.line(0, "</courseStructure>");
    return `${this.lines.join("\n")}\n`;
  }
}

/** Checks every extension of a structure, with its path. */
function checkExtensions(structure: CourseStructure): void {
  const check = (extensions: readonly ExtensionElement[], path: string): void => {
    for (const [index, extension] of extensions.entries()) checkExtensionElement(extension, `${path}[${index}]`);
  };
  const members = (list: readonly (AssignableUnit | Block)[], path: string): void => {
    for (const [index, member] of list.entries()) {
      const at = `${path}[${index}]`;
      check(member.extensions, `${at}.extensions`);
      if (member.kind === "block") members(member.children, `${at}.children`);
    }
  };
  check(structure.extensions, "extensions");
  check(structure.course.extensions, "course.extensions");
  members(structure.children, "children");
}

/**
 * Writes a course structure as the `cmi5.xml` of a course package: UTF-8, indented, with each extension as written.
 *
 * @remarks
 * The structure is checked deeply first, each extension is parsed as one element of its namespace, and the text that is
 * written is read again by the rules of `readCourseStructure` with its default limits, as in a package: what the writer
 * returns, the reader takes. A relative URL is written as it is; a structure without a package needs fully qualified URLs.
 * `moveOn` and `launchMethod` are always written, and the extensions of the structure come after its members.
 *
 * @param structure - The structure, such as `readCourseStructure` returns.
 * @param options - The schemes that the URL of an assignable unit may have, as the reader takes them.
 * @returns The XML.
 * @throws `DataError` that names the path of the first fault: a value of the wrong type, a text that XML cannot hold, an
 * extension that is not one element of its namespace, or a rule of cmi5 that the structure breaks; and that names the option,
 * when an option is not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_package | cmi5, 14.0 Course Package}
 */
export function writeCourseStructure(structure: CourseStructure, options?: CourseWriteOptions): string {
  const { launchSchemes } = parseWith(writeOptionsSchema, options === undefined ? {} : options, "The options object");
  checkNesting(structure);
  const checked = parseWith(structureSchema, structure, "The course structure");
  checkExtensions(checked);
  const xml = new StructureWriter().structure(checked);
  readStructureWith(
    xml,
    readCourseReadOptions({ packaged: true, ...(launchSchemes === undefined ? {} : { launchSchemes }) }),
  );
  return xml;
}
