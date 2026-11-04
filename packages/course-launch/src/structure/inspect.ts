import { LimitError } from "@interopkit/core";
import { type IssueSink, isAbsoluteUri } from "@interopkit/core/checks";
import { SaxesParser, type SaxesTagNS } from "saxes";
import {
  type AssignableUnit,
  type Block,
  COURSE_STRUCTURE_NAMESPACE,
  type Course,
  type CourseStructure,
  type ExtensionElement,
  LAUNCH_METHODS,
  type LangString,
  type LaunchMethod,
  MOVE_ON_VALUES,
  type MoveOn,
  type Objective,
} from "../model/index.js";
import { checkDeclaredEncoding, decodeStructure, type StructureEncoding } from "./decode.js";
import { launchUrlProblems } from "./launch-url.js";
import type { CourseReadSettings } from "./options.js";
import { ELEMENTS, type ElementDefinition, type ElementKind } from "./schema.js";
import { isLanguage, isSpace, readMasteryScore, trimSpace } from "./values.js";

/** The most characters that go to the parser at once. */
const CHUNK = 65_536;

/** A member of a course or a block. */
type Member = AssignableUnit | Block;

/** An element of cmi5 that is open, with what its children gave it. */
interface Frame {
  readonly kind: ElementKind;
  readonly name: string;
  readonly path: string;
  readonly definition: ElementDefinition;
  /** The namespaces that the element declares, by prefix, or `undefined` when it declares none. */
  readonly declared: ReadonlyMap<string, string> | undefined;
  /** The attributes of no namespace that it has, as written. */
  readonly attributes: ReadonlyMap<string, string>;
  /** The slot of the sequence that the last child filled, and how often it filled it. */
  slot: number;
  filled: number;
  /** The children of an `xs:all` that came. */
  readonly seen: Set<string>;
  /** Whether text where only elements may be was reported. */
  stray: boolean;
  readonly text: string[];
  title: readonly LangString[];
  description: readonly LangString[];
  readonly langstrings: LangString[];
  objectives: readonly Objective[];
  references: readonly string[];
  readonly declaredObjectives: Objective[];
  readonly referenceIds: string[];
  readonly members: Member[];
  readonly extensions: ExtensionElement[];
  course: Course | undefined;
  url: string | undefined;
  launchParameters: string | undefined;
  entitlementKey: string | undefined;
}

/** An extension that is being read: where it starts, and the prefixes it uses from the elements around it. */
interface Capture {
  /** The frame that keeps it, or `undefined` for one inside an element whose model has no place for extensions. */
  readonly owner: Frame | undefined;
  readonly start: number;
  readonly tag: SaxesTagNS;
  /** The prefixes, `""` for the default namespace, that it uses and does not declare where it uses them. */
  readonly used: Set<string>;
  /** The prefixes that each of its open elements declares, from its root. */
  readonly scopes: (readonly string[])[];
}

/** Ends the walk once a finding makes the rest moot, or the list of findings is full. */
class StopWalk extends Error {}

/** The kinds of member whose ids must differ from each other's (13.1.2, 13.1.3, 13.1.4). */
type IdentifiedKind = "objective" | "block" | "au";

const KIND_NAMES: Readonly<Record<IdentifiedKind, string>> = {
  objective: "objective",
  block: "block",
  au: "assignable unit",
};

/** Joins a path and the name of a property. */
function join(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

/** Names an element in a message by its namespace and local name. */
function elementLabel(uri: string, local: string): string {
  if (uri === COURSE_STRUCTURE_NAMESPACE) return `<${local}>`;
  return uri === "" ? `<${local}> of no namespace` : `<${local}> of ${uri}`;
}

/** Escapes a value of an attribute. */
function escapeAttribute(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

/**
 * Notes an element of an extension that opens: the prefixes it declares, and those it uses that the extension does not
 * declare around it: that of its name, `""` for the default namespace, and those of its attributes. An attribute without a
 * prefix is in no namespace, and a declaration uses none.
 */
function enterCapture(capture: Capture, tag: SaxesTagNS): void {
  capture.scopes.push(Object.keys(tag.ns));
  const use = (prefix: string): void => {
    if (!capture.scopes.some((declared) => declared.includes(prefix))) capture.used.add(prefix);
  };
  use(tag.prefix);
  for (const attribute of Object.values(tag.attributes)) {
    if (attribute.prefix !== "" && attribute.prefix !== "xmlns") use(attribute.prefix);
  }
}

/** Tells whether an attribute of a namespace may appear on an element: one other than cmi5's, where the schema allows one. */
function isForeignAllowed(uri: string, definition: ElementDefinition): boolean {
  return uri !== "" && uri !== COURSE_STRUCTURE_NAMESPACE && definition.anyAttribute;
}

/** Tells whether a value is one of a vocabulary. */
function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((known) => known === value);
}

/** Walks a course structure with a parser that tracks namespaces, and builds its model and its findings as it goes. */
class StructureWalk {
  private readonly parser = new SaxesParser({ xmlns: true });
  private readonly stack: Frame[] = [];
  private readonly ids: Readonly<Record<IdentifiedKind, Map<string, string>>> = {
    objective: new Map(),
    block: new Map(),
    au: new Map(),
  };
  private readonly references: { readonly idref: string; readonly path: string }[] = [];
  private depth = 0;
  private counted = 0;
  /** The depth inside an element that is not read as cmi5: an extension, or an element where none may be. */
  private skipped = 0;
  private capture: Capture | undefined;
  private result: CourseStructure | undefined;
  private readonly text: string;
  private readonly encoding: StructureEncoding | undefined;
  private readonly settings: CourseReadSettings;
  private readonly sink: IssueSink;

  constructor(text: string, encoding: StructureEncoding | undefined, settings: CourseReadSettings, sink: IssueSink) {
    this.text = text;
    this.encoding = encoding;
    this.settings = settings;
    this.sink = sink;
  }

  run(): CourseStructure | undefined {
    const { parser } = this;
    parser.on("xmldecl", ({ encoding }) => checkDeclaredEncoding(encoding, this.encoding));
    parser.on("doctype", () => this.stop("", "doctype", "has a DOCTYPE, which a course structure may not have."));
    parser.on("error", (error) => this.stop("", "well-formed", `is not well-formed XML: ${error.message}`));
    parser.on("opentagstart", () => this.count(true));
    parser.on("attribute", () => this.count(false));
    parser.on("opentag", (tag) => this.open(tag));
    parser.on("closetag", () => this.close());
    parser.on("text", (text) => this.read(text));
    parser.on("cdata", (text) => this.read(text));
    try {
      for (let at = 0; at < this.text.length; at += CHUNK) parser.write(this.text.slice(at, at + CHUNK));
      parser.close();
      this.checkReferences();
    } catch (error) {
      if (error instanceof StopWalk) return undefined;
      throw error;
    }
    return this.result;
  }

  /** Adds a finding, and ends the walk when the list is full. */
  private report(path: string, rule: string, message: string): void {
    this.sink.add([{ path, rule, message, severity: "error" }]);
    if (this.sink.stopped) throw new StopWalk();
  }

  /** Adds a finding after which nothing more can be read. */
  private stop(path: string, rule: string, message: string): never {
    this.sink.add([{ path, rule, message, severity: "error" }]);
    throw new StopWalk();
  }

  /** Counts an element or an attribute against the limits, before the parser keeps anything of it. */
  private count(element: boolean): void {
    const { maxDepth, maxElements } = this.settings;
    this.counted += 1;
    if (this.counted > maxElements) {
      throw new LimitError(
        `The course structure has more than ${maxElements} elements and attributes, the limit of the option maxElements.`,
        "maxElements",
        maxElements,
      );
    }
    if (element && this.depth >= maxDepth) {
      throw new LimitError(
        `The course structure nests more than ${maxDepth} elements, the limit of the option maxDepth.`,
        "maxDepth",
        maxDepth,
      );
    }
    if (element) this.depth += 1;
  }

  private open(tag: SaxesTagNS): void {
    if (this.skipped > 0) {
      this.skipped += 1;
      if (this.capture !== undefined) enterCapture(this.capture, tag);
      return;
    }
    const parent = this.stack.at(-1);
    if (parent === undefined) {
      if (tag.uri !== COURSE_STRUCTURE_NAMESPACE || tag.local !== "courseStructure") {
        this.stop(
          "",
          "root",
          `has the root ${elementLabel(tag.uri, tag.local)}, and a course structure is a <courseStructure> of ${COURSE_STRUCTURE_NAMESPACE}.`,
        );
      }
      this.enter("courseStructure", tag, "");
      return;
    }
    if (tag.uri === COURSE_STRUCTURE_NAMESPACE) {
      const kind = parent.definition.children[tag.local];
      if (kind !== undefined && this.place(parent, tag.local)) {
        this.enter(kind, tag, this.pathOf(parent, kind, tag.local));
        return;
      }
    } else if (tag.uri !== "" && parent.definition.extensions) {
      this.place(parent, undefined);
      this.startCapture(parent, tag);
      return;
    }
    this.report(
      parent.path,
      "unexpected-element",
      `has an unexpected element ${elementLabel(tag.uri, tag.local)} here.`,
    );
    this.skipped = 1;
  }

  /** The path of a child of cmi5 of a parent. */
  private pathOf(parent: Frame, kind: ElementKind, name: string): string {
    switch (kind) {
      case "objective":
        return `${parent.path}[${parent.declaredObjectives.length}]`;
      case "reference":
        return `${parent.path}[${parent.referenceIds.length}]`;
      case "langstring":
        return `${parent.path}[${parent.langstrings.length}]`;
      case "au":
      case "block":
        return `${join(parent.path, "children")}[${parent.members.length}]`;
      default:
        return join(parent.path, name);
    }
  }

  /**
   * Places a child in the content of its parent: an element of cmi5 by its name, or an extension when `name` is `undefined`.
   * Each slot that the child passes and that needs an element it did not get is a missing element.
   *
   * @returns Whether the content takes the child there.
   */
  private place(parent: Frame, name: string | undefined): boolean {
    if (parent.definition.content === "all") {
      if (name === undefined || parent.seen.has(name)) return false;
      parent.seen.add(name);
      return true;
    }
    const { slots } = parent.definition;
    // An extension goes after every slot; an element of cmi5 into the first slot from here that takes it and has room.
    const index =
      name === undefined
        ? slots.length
        : slots.findIndex(
            (slot, at) =>
              at >= parent.slot && slot.names.includes(name) && (at > parent.slot || parent.filled < slot.max),
          );
    if (index < 0) return false;
    this.missing(parent, parent.slot, index);
    parent.filled = index === parent.slot ? parent.filled + 1 : 1;
    parent.slot = index;
    return true;
  }

  /** Reports the slots from one to before another that need more elements than they got. */
  private missing(parent: Frame, from: number, to: number): void {
    const { slots } = parent.definition;
    for (const [index, slot] of slots.entries()) {
      if (index < from || index >= to) continue;
      const got = index === parent.slot ? parent.filled : 0;
      if (got < slot.min) {
        this.report(parent.path, "missing-element", `has no ${slot.names.map((name) => `<${name}>`).join(" or ")}.`);
      }
    }
  }

  private enter(kind: ElementKind, tag: SaxesTagNS, path: string): void {
    const definition = ELEMENTS[kind];
    const { declared, attributes } = this.attributesOf(tag, definition, path);
    const frame: Frame = {
      kind,
      name: tag.local,
      path,
      definition,
      declared: declared.size === 0 ? undefined : declared,
      attributes,
      slot: 0,
      filled: 0,
      seen: new Set(),
      stray: false,
      text: [],
      title: [],
      description: [],
      langstrings: [],
      objectives: [],
      references: [],
      declaredObjectives: [],
      referenceIds: [],
      members: [],
      extensions: [],
      course: undefined,
      url: undefined,
      launchParameters: undefined,
      entitlementKey: undefined,
    };
    this.checkAttributes(frame);
    this.stack.push(frame);
  }

  /**
   * Reads the attributes of an element: the namespaces it declares, and the attributes of no namespace that it has. Any other
   * is unexpected, except an attribute of another namespace where the schema allows one, which is dropped (Not included).
   */
  private attributesOf(tag: SaxesTagNS, definition: ElementDefinition, path: string) {
    const declared = new Map<string, string>();
    const attributes = new Map<string, string>();
    for (const attribute of Object.values(tag.attributes)) {
      const { prefix, local, uri, value } = attribute;
      if (prefix === "xmlns" || attribute.name === "xmlns") declared.set(prefix === "xmlns" ? local : "", value.trim());
      else if (uri === "" && definition.attributes.includes(local)) attributes.set(local, value);
      else if (!isForeignAllowed(uri, definition)) {
        this.report(path, "unexpected-attribute", `has an unexpected attribute ${attribute.name}.`);
      }
    }
    for (const name of definition.required) {
      if (!attributes.has(name)) this.report(path, "missing-attribute", `has no attribute ${name}.`);
    }
    return { declared, attributes };
  }

  /** Judges the values of the attributes of an element. */
  private checkAttributes(frame: Frame): void {
    const id = frame.attributes.get("id");
    if (id !== undefined) this.checkId(frame, trimSpace(id));
    const idref = frame.attributes.get("idref");
    if (idref !== undefined) {
      const trimmed = trimSpace(idref);
      this.checkIri(join(frame.path, "idref"), trimmed);
      this.references.push({ idref: trimmed, path: join(frame.path, "idref") });
    }
    const lang = frame.attributes.get("lang");
    if (lang !== undefined && !isLanguage(trimSpace(lang))) {
      this.report(
        join(frame.path, "lang"),
        "language",
        `${JSON.stringify(lang)} is not a language tag of xs:language.`,
      );
    }
    if (frame.kind === "au") this.checkAssignableUnit(frame);
  }

  private checkId(frame: Frame, id: string): void {
    const path = join(frame.path, "id");
    this.checkIri(path, id);
    if (frame.kind !== "objective" && frame.kind !== "block" && frame.kind !== "au") return;
    const seen = this.ids[frame.kind];
    const first = seen.get(id);
    if (first === undefined) seen.set(id, frame.path);
    else {
      this.report(
        path,
        "duplicate-id",
        `${JSON.stringify(id)} is the id of ${first} too: each ${KIND_NAMES[frame.kind]} needs an id of its own.`,
      );
    }
  }

  private checkIri(path: string, value: string): void {
    if (!isAbsoluteUri(value)) {
      this.report(path, "iri", `${JSON.stringify(value)} is not a fully qualified IRI.`);
    }
  }

  private checkAssignableUnit(frame: Frame): void {
    const { attributes, path } = frame;
    const moveOn = attributes.get("moveOn");
    if (moveOn !== undefined && !isOneOf(MOVE_ON_VALUES, moveOn)) {
      this.report(
        join(path, "moveOn"),
        "enumeration",
        `${JSON.stringify(moveOn)} is not one of ${MOVE_ON_VALUES.join(", ")}.`,
      );
    }
    const launchMethod = attributes.get("launchMethod");
    if (launchMethod !== undefined && !isOneOf(LAUNCH_METHODS, launchMethod)) {
      this.report(
        join(path, "launchMethod"),
        "enumeration",
        `${JSON.stringify(launchMethod)} is not one of ${LAUNCH_METHODS.join(", ")}.`,
      );
    }
    const masteryScore = attributes.get("masteryScore");
    if (masteryScore !== undefined) {
      const read = readMasteryScore(trimSpace(masteryScore));
      if ("problem" in read) {
        this.report(
          join(path, "masteryScore"),
          "mastery-score",
          `${JSON.stringify(masteryScore)} is not a decimal from 0 to 1 with at most 4 decimal places.`,
        );
      }
    }
    const activityType = attributes.get("activityType");
    if (activityType !== undefined) this.checkIri(join(path, "activityType"), trimSpace(activityType));
  }

  /** Starts to read an extension as written, from the `<` of its tag. */
  private startCapture(parent: Frame, tag: SaxesTagNS): void {
    const keeps =
      parent.kind === "courseStructure" || parent.kind === "course" || parent.kind === "block" || parent.kind === "au";
    // The parser has read the whole start tag; it begins at the last `<` before it, since no name or space holds one.
    const capture: Capture = {
      owner: keeps ? parent : undefined,
      start: this.text.lastIndexOf("<", this.parser.position - 1),
      tag,
      used: new Set(),
      scopes: [],
    };
    enterCapture(capture, tag);
    this.capture = capture;
    this.skipped = 1;
  }

  /** Ends the extension that is being read, and gives its owner the element with the namespaces it uses from around it. */
  private endCapture(capture: Capture): void {
    const { owner, start, tag, used } = capture;
    this.capture = undefined;
    if (owner === undefined) return;
    const written = this.text.slice(start, this.parser.position);
    const inScope = new Map<string, string>();
    for (const frame of this.stack) {
      for (const [prefix, uri] of frame.declared ?? []) inScope.set(prefix, uri);
    }
    let declarations = "";
    for (const prefix of used) {
      const uri = inScope.get(prefix);
      // `xml` is bound everywhere, and a default namespace of none needs no declaration.
      if (uri === undefined || uri === "") continue;
      declarations += ` ${prefix === "" ? "xmlns" : `xmlns:${prefix}`}="${escapeAttribute(uri)}"`;
    }
    const afterName = 1 + tag.name.length;
    owner.extensions.push({
      namespace: tag.uri,
      name: tag.local,
      xml: `${written.slice(0, afterName)}${declarations}${written.slice(afterName)}`,
    });
  }

  private read(text: string): void {
    const frame = this.stack.at(-1);
    if (this.skipped > 0 || frame === undefined) return;
    const { content } = frame.definition;
    if (content === "text") frame.text.push(text);
    // An element that is empty holds no text at all, white space included, as libxml2 reads the schema.
    else if (!(frame.stray || (content !== "empty" && isSpace(text)))) {
      frame.stray = true;
      const allowed = content === "empty" ? "nothing" : "elements alone";
      this.report(frame.path, "unexpected-text", `holds text where the schema allows ${allowed}.`);
    }
  }

  private close(): void {
    this.depth -= 1;
    if (this.skipped > 0) {
      this.skipped -= 1;
      this.capture?.scopes.pop();
      if (this.skipped === 0 && this.capture !== undefined) this.endCapture(this.capture);
      return;
    }
    // Outside an extension, a tag that closes is the frame on the top of the stack: the parser checks that tags match.
    for (const frame of this.stack.splice(-1)) {
      this.finish(frame);
      const parent = this.stack.at(-1);
      if (parent === undefined) this.result = this.structureOf(frame);
      else this.deliver(frame, parent);
    }
  }

  /** Reports the elements that an element needed and did not get. */
  private finish(frame: Frame): void {
    const { content, slots } = frame.definition;
    if (content === "elements") this.missing(frame, frame.slot, slots.length);
    if (content === "all") {
      for (const slot of slots) {
        for (const name of slot.names) {
          if (!frame.seen.has(name)) this.report(frame.path, "missing-element", `has no <${name}>.`);
        }
      }
    }
  }

  /** Gives the parent of an element what the element stands for. */
  private deliver(frame: Frame, parent: Frame): void {
    const text = trimSpace(frame.text.join(""));
    switch (frame.kind) {
      case "langstring":
        parent.langstrings.push(this.langStringOf(frame, text));
        return;
      case "url":
        this.checkUrl(frame.path, text);
        parent.url = text;
        return;
      default:
        this.deliverModel(frame, parent, text);
    }
  }

  private deliverModel(frame: Frame, parent: Frame, text: string): void {
    switch (frame.kind) {
      case "course":
        parent.course = {
          id: this.idOf(frame),
          title: frame.title,
          description: frame.description,
          extensions: frame.extensions,
        };
        return;
      case "objectiveList":
        parent.objectives = frame.declaredObjectives;
        return;
      case "objective":
        parent.declaredObjectives.push({ id: this.idOf(frame), title: frame.title, description: frame.description });
        return;
      case "referenceList":
        parent.references = frame.referenceIds;
        return;
      case "reference":
        parent.referenceIds.push(trimSpace(frame.attributes.get("idref") ?? ""));
        return;
      case "text":
        if (frame.name === "title") parent.title = frame.langstrings;
        else parent.description = frame.langstrings;
        return;
      case "string":
        if (frame.name === "launchParameters") parent.launchParameters = text;
        else parent.entitlementKey = text;
        return;
      default:
        parent.members.push(frame.kind === "au" ? this.unitOf(frame) : this.blockOf(frame));
    }
  }

  private idOf(frame: Frame): string {
    return trimSpace(frame.attributes.get("id") ?? "");
  }

  private langStringOf(frame: Frame, text: string): LangString {
    const lang = frame.attributes.get("lang");
    return lang === undefined ? { text } : { lang: trimSpace(lang), text };
  }

  private structureOf(frame: Frame): CourseStructure {
    return {
      course: frame.course ?? { id: "", title: [], description: [], extensions: [] },
      objectives: frame.objectives,
      children: frame.members,
      extensions: frame.extensions,
    };
  }

  private blockOf(frame: Frame): Block {
    return {
      kind: "block",
      id: this.idOf(frame),
      title: frame.title,
      description: frame.description,
      objectives: frame.references,
      children: frame.members,
      extensions: frame.extensions,
    };
  }

  private unitOf(frame: Frame): AssignableUnit {
    const { attributes } = frame;
    const moveOn = attributes.get("moveOn") ?? "NotApplicable";
    const launchMethod = attributes.get("launchMethod") ?? "AnyWindow";
    const masteryScore = readMasteryScore(trimSpace(attributes.get("masteryScore") ?? ""));
    const activityType = attributes.get("activityType");
    return {
      kind: "au",
      id: this.idOf(frame),
      title: frame.title,
      description: frame.description,
      objectives: frame.references,
      url: frame.url ?? "",
      launchMethod: isOneOf<LaunchMethod>(LAUNCH_METHODS, launchMethod) ? launchMethod : "AnyWindow",
      moveOn: isOneOf<MoveOn>(MOVE_ON_VALUES, moveOn) ? moveOn : "NotApplicable",
      ...("value" in masteryScore ? { masteryScore: masteryScore.value } : {}),
      ...(activityType === undefined ? {} : { activityType: trimSpace(activityType) }),
      ...(frame.launchParameters === undefined ? {} : { launchParameters: frame.launchParameters }),
      ...(frame.entitlementKey === undefined ? {} : { entitlementKey: frame.entitlementKey }),
      extensions: frame.extensions,
    };
  }

  private checkUrl(path: string, url: string): void {
    for (const { rule, message } of launchUrlProblems(url, this.settings)) this.report(path, rule, message);
  }

  /** Reports each objective reference that names no objective of the structure. */
  private checkReferences(): void {
    for (const { idref, path } of this.references) {
      if (!this.ids.objective.has(idref)) {
        this.report(
          path,
          "objective-reference",
          `${JSON.stringify(idref)} names no objective of the course structure.`,
        );
      }
    }
  }
}

/**
 * Reads a course structure into its model and its findings: every constraint of `CourseStructure.xsd`, and the rules of cmi5
 * that the schema leaves out.
 *
 * @returns The model, or `undefined` when the walk ended early: the structure is not well-formed, has a DOCTYPE or another
 * root, or the findings filled the list. The model of a structure with errors is a best effort.
 * @throws `DataError` when the structure is neither text nor bytes, is not valid in its encoding, or passes a limit.
 */
export function inspectCourseStructure(
  input: unknown,
  settings: CourseReadSettings,
  sink: IssueSink,
): CourseStructure | undefined {
  const { text, encoding } = decodeStructure(input, settings.maxBytes);
  return new StructureWalk(text, encoding, settings, sink).run();
}
