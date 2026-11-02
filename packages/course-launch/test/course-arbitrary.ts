import fc from "fast-check";
import type { AssignableUnit, Block, CourseStructure, ExtensionElement, LangString } from "../src/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
export const RUNS = { seed: 20_261_103, numRuns: 200 };

/** Characters that XML holds, those it must escape and white space among them, and some beyond ASCII. */
const CHARACTER = fc.oneof(
  fc.constantFrom(..."ab Z09<>&\"'\t\n\r]]é☺𝄞 "),
  fc.integer({ min: 0x20, max: 0xd7ff }).map((code) => String.fromCharCode(code)),
);

/** Text without the white space of XML around it, as the reader gives it. */
const TEXT = fc
  .array(CHARACTER, { maxLength: 12 })
  .map((characters) => characters.join("").replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, ""));

const LANG_STRINGS: fc.Arbitrary<readonly LangString[]> = fc.array(
  fc.record(
    { lang: fc.constantFrom("en", "en-US", "fr-CA", "zh-Hant-TW"), text: TEXT },
    { requiredKeys: ["text"], noNullPrototype: true },
  ),
  { minLength: 1, maxLength: 3 },
);

/** An element of another namespace, with text that it escapes. */
const EXTENSIONS: fc.Arbitrary<readonly ExtensionElement[]> = fc.array(
  TEXT.map((text) => ({
    namespace: "urn:example:extension",
    name: "note",
    xml: `<x:note xmlns:x="urn:example:extension" x:kind="a">${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;")}</x:note>`,
  })),
  { maxLength: 2 },
);

/** A URL that an assignable unit may have in a package: fully qualified with https, or relative to its root. */
const URL_TEXT = fc
  .tuple(
    fc.constantFrom("https://example.org/", "http://example.org:8080/a/", ""),
    fc.array(
      fc.stringMatching(/^[a-z0-9._-]{1,8}$/u).filter((segment) => segment !== "." && segment !== ".."),
      {
        minLength: 1,
        maxLength: 3,
      },
    ),
    fc.constantFrom("", "?lesson=1", "?a=1&b=%20#start"),
  )
  .map(([base, segments, rest]) => `${base}${segments.join("/")}${rest}`);

interface UnitShape {
  readonly kind: "au";
}
interface BlockShape {
  readonly kind: "block";
  readonly children: readonly (UnitShape | BlockShape)[];
}

const SHAPES = fc.letrec<{ member: UnitShape | BlockShape }>((tie) => ({
  member: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constant<UnitShape>({ kind: "au" }),
    fc.record(
      { kind: fc.constant<"block">("block"), children: fc.array(tie("member"), { minLength: 1, maxLength: 3 }) },
      { noNullPrototype: true },
    ),
  ),
})).member;

/** What a member has besides its shape and id. */
const DETAILS = fc.record(
  {
    title: LANG_STRINGS,
    description: LANG_STRINGS,
    url: URL_TEXT,
    launchMethod: fc.constantFrom("AnyWindow", "OwnWindow"),
    moveOn: fc.constantFrom("Passed", "Completed", "CompletedAndPassed", "CompletedOrPassed", "NotApplicable"),
    masteryScore: fc.option(
      fc.integer({ min: 0, max: 10_000 }).map((score) => score / 10_000),
      { nil: undefined },
    ),
    activityType: fc.option(fc.constantFrom("http://adlnet.gov/expapi/activities/media", "urn:example:type"), {
      nil: undefined,
    }),
    launchParameters: fc.option(TEXT, { nil: undefined }),
    entitlementKey: fc.option(TEXT, { nil: undefined }),
    extensions: EXTENSIONS,
    references: fc.array(fc.nat(2), { maxLength: 2 }),
  },
  { noNullPrototype: true },
);

/** What a member has besides its shape and id, as the arbitrary gives it. */
type Details = typeof DETAILS extends fc.Arbitrary<infer TDetails> ? TDetails : never;

/** Gives each member of a shape its id and details, the ids unique among the members of each kind. */
function build(
  shapes: readonly (UnitShape | BlockShape)[],
  details: readonly Details[],
  objectives: readonly string[],
  counter: { value: number },
): (AssignableUnit | Block)[] {
  return shapes.map((shape) => {
    counter.value += 1;
    const detail = details[counter.value % details.length] as Details;
    const references = [...new Set(detail.references.filter((index) => index < objectives.length))].map(
      (index) => objectives[index] as string,
    );
    const common = {
      id: `https://example.org/members/${counter.value}`,
      title: detail.title,
      description: detail.description,
      objectives: references,
    };
    if (shape.kind === "block") {
      return {
        kind: "block",
        ...common,
        children: build(shape.children, details, objectives, counter),
        extensions: detail.extensions,
      };
    }
    const { masteryScore, activityType, launchParameters, entitlementKey } = detail;
    return {
      kind: "au",
      ...common,
      url: detail.url,
      launchMethod: detail.launchMethod,
      moveOn: detail.moveOn,
      ...(masteryScore === undefined ? {} : { masteryScore }),
      ...(activityType === undefined ? {} : { activityType }),
      ...(launchParameters === undefined ? {} : { launchParameters }),
      ...(entitlementKey === undefined ? {} : { entitlementKey }),
      extensions: detail.extensions,
    };
  });
}

/** Course structures that conform, of every element the model has, as the reader gives them back from a package. */
export const COURSE_STRUCTURES: fc.Arbitrary<CourseStructure> = fc
  .record(
    {
      title: LANG_STRINGS,
      description: LANG_STRINGS,
      courseExtensions: EXTENSIONS,
      extensions: EXTENSIONS,
      objectives: fc.array(fc.record({ title: LANG_STRINGS, description: LANG_STRINGS }, { noNullPrototype: true }), {
        maxLength: 3,
      }),
      members: fc.array(SHAPES, { minLength: 1, maxLength: 4 }),
      details: fc.array(DETAILS, { minLength: 1, maxLength: 4 }),
    },
    { noNullPrototype: true },
  )
  .map(({ title, description, courseExtensions, extensions, objectives, members, details }) => {
    const objectiveIds = objectives.map((_, index) => `urn:example:objectives:${index}`);
    return {
      course: { id: "https://example.org/courses/generated", title, description, extensions: courseExtensions },
      objectives: objectives.map((objective, index) => ({ id: objectiveIds[index] as string, ...objective })),
      children: build(members, details, objectiveIds, { value: 0 }),
      extensions,
    };
  });
