/**
 * The elements of `CourseStructure.xsd` as the reader walks them: what each holds, in which order, and which attributes it
 * has. The reader enforces every constraint of the schema with these, and the tests compare its verdicts with libxml2's.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/v1/CourseStructure.xsd | CourseStructure.xsd}
 */

/** What an element of the course structure is to the reader. */
export type ElementKind =
  | "courseStructure"
  | "course"
  | "objectiveList"
  | "objective"
  | "referenceList"
  | "reference"
  | "block"
  | "au"
  | "text"
  | "langstring"
  | "url"
  | "string";

/** A place in the sequence of an element: the names it takes, and how often. */
interface Slot {
  readonly names: readonly string[];
  readonly min: number;
  readonly max: number;
}

/** An element of the schema. */
export interface ElementDefinition {
  /**
   * What it holds: elements in the order of `slots`; the elements of `slots` once each, in any order (`xs:all`); text; or
   * nothing.
   */
  readonly content: "elements" | "all" | "text" | "empty";
  readonly slots: readonly Slot[];
  /** The kind of each element of cmi5 it may hold, by local name. */
  readonly children: Readonly<Partial<Record<string, ElementKind>>>;
  /** Whether elements of another namespace may follow the others (`xs:any namespace="##other"`). */
  readonly extensions: boolean;
  /** The attributes of no namespace that it has. */
  readonly attributes: readonly string[];
  /** Those of its attributes that it needs. */
  readonly required: readonly string[];
  /** Whether attributes of another namespace may appear on it (`xs:anyAttribute namespace="##other"`). */
  readonly anyAttribute: boolean;
}

const UNBOUNDED = Number.POSITIVE_INFINITY;
const once = (name: string): Slot => ({ names: [name], min: 1, max: 1 });
const optional = (name: string): Slot => ({ names: [name], min: 0, max: 1 });
const members: Slot = { names: ["au", "block"], min: 1, max: UNBOUNDED };

/** A title or a description: one or more `langstring` elements. */
const TEXT: ElementDefinition = {
  content: "elements",
  slots: [{ names: ["langstring"], min: 1, max: UNBOUNDED }],
  children: { langstring: "langstring" },
  extensions: true,
  attributes: [],
  required: [],
  anyAttribute: true,
};

/** The elements of the schema by kind. */
export const ELEMENTS: Readonly<Record<ElementKind, ElementDefinition>> = {
  courseStructure: {
    content: "elements",
    slots: [once("course"), optional("objectives"), members],
    children: { course: "course", objectives: "objectiveList", au: "au", block: "block" },
    extensions: true,
    attributes: [],
    required: [],
    anyAttribute: true,
  },
  course: {
    content: "elements",
    slots: [once("title"), once("description")],
    children: { title: "text", description: "text" },
    extensions: true,
    attributes: ["id"],
    required: ["id"],
    anyAttribute: true,
  },
  objectiveList: {
    content: "elements",
    slots: [{ names: ["objective"], min: 1, max: UNBOUNDED }],
    children: { objective: "objective" },
    extensions: true,
    attributes: [],
    required: [],
    anyAttribute: true,
  },
  objective: {
    content: "all",
    slots: [once("title"), once("description")],
    children: { title: "text", description: "text" },
    extensions: false,
    attributes: ["id"],
    required: ["id"],
    anyAttribute: false,
  },
  referenceList: {
    content: "elements",
    slots: [{ names: ["objective"], min: 1, max: UNBOUNDED }],
    children: { objective: "reference" },
    extensions: true,
    attributes: [],
    required: [],
    anyAttribute: true,
  },
  // The schema leaves idref optional; a reference without one names no objective, which cmi5 has no use for.
  reference: {
    content: "empty",
    slots: [],
    children: {},
    extensions: false,
    attributes: ["idref"],
    required: ["idref"],
    anyAttribute: false,
  },
  block: {
    content: "elements",
    slots: [once("title"), once("description"), optional("objectives"), members],
    children: { title: "text", description: "text", objectives: "referenceList", au: "au", block: "block" },
    extensions: true,
    attributes: ["id"],
    required: ["id"],
    anyAttribute: true,
  },
  au: {
    content: "elements",
    slots: [
      once("title"),
      once("description"),
      optional("objectives"),
      once("url"),
      optional("launchParameters"),
      optional("entitlementKey"),
    ],
    children: {
      title: "text",
      description: "text",
      objectives: "referenceList",
      url: "url",
      launchParameters: "string",
      entitlementKey: "string",
    },
    extensions: true,
    attributes: ["id", "moveOn", "masteryScore", "launchMethod", "activityType"],
    required: ["id"],
    anyAttribute: true,
  },
  text: TEXT,
  langstring: {
    content: "text",
    slots: [],
    children: {},
    extensions: false,
    attributes: ["lang"],
    required: [],
    anyAttribute: true,
  },
  url: {
    content: "text",
    slots: [],
    children: {},
    extensions: false,
    attributes: [],
    required: [],
    anyAttribute: false,
  },
  // The schema leaves launchParameters and entitlementKey untyped (xs:anyType); cmi5 types both as strings (13.1.4).
  string: {
    content: "text",
    slots: [],
    children: {},
    extensions: false,
    attributes: [],
    required: [],
    anyAttribute: false,
  },
};
