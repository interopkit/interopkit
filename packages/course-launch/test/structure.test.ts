// cspell:ignore aalert Ehtml
import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import {
  type CourseStructure,
  readCourseStructure,
  validateCourseStructure,
  writeCourseStructure,
} from "../src/index.js";
import { au, block, NAMESPACE, OBJECTIVE, structure, TEXTS, withUnit, withUrl } from "./course-xml.js";

/** The first finding of a structure, as path and rule. */
function firstFinding(xml: string | Uint8Array, options = {}) {
  const [first] = validateCourseStructure(xml, options);
  return first === undefined ? undefined : { path: first.path, rule: first.rule };
}

const T = [{ lang: "en", text: "T" }];
const D = [{ lang: "en", text: "D" }];

describe("reading a course structure", () => {
  it("reads the course, its objectives, blocks in blocks and assignable units into the model", () => {
    const xml = structure(
      `<objectives>${OBJECTIVE}</objectives>${block(
        "https://example.org/blocks/1",
        `<objectives><objective idref="https://example.org/objectives/1"/></objectives>${block(
          "https://example.org/blocks/2",
          au(
            'id="https://example.org/au/1" moveOn="CompletedAndPassed" masteryScore="0.85" launchMethod="OwnWindow" activityType="http://adlnet.gov/expapi/activities/media"',
            '<objectives><objective idref="https://example.org/objectives/1"/></objectives><url>https://example.org/au/1/index.html</url><launchParameters>Start=1</launchParameters><entitlementKey>xyz-123</entitlementKey>',
          ),
        )}`,
      )}${au('id="https://example.org/au/2"')}`,
    );
    const unit = {
      kind: "au",
      id: "https://example.org/au/1",
      title: T,
      description: D,
      objectives: ["https://example.org/objectives/1"],
      url: "https://example.org/au/1/index.html",
      launchMethod: "OwnWindow",
      moveOn: "CompletedAndPassed",
      masteryScore: 0.85,
      activityType: "http://adlnet.gov/expapi/activities/media",
      launchParameters: "Start=1",
      entitlementKey: "xyz-123",
      extensions: [],
    };
    expect(readCourseStructure(xml)).toStrictEqual({
      course: { id: "https://example.org/course", title: T, description: D, extensions: [] },
      objectives: [{ id: "https://example.org/objectives/1", title: T, description: D }],
      children: [
        {
          kind: "block",
          id: "https://example.org/blocks/1",
          title: T,
          description: D,
          objectives: ["https://example.org/objectives/1"],
          children: [
            {
              kind: "block",
              id: "https://example.org/blocks/2",
              title: T,
              description: D,
              objectives: [],
              children: [unit],
              extensions: [],
            },
          ],
          extensions: [],
        },
        {
          kind: "au",
          id: "https://example.org/au/2",
          title: T,
          description: D,
          objectives: [],
          url: "https://example.org/au/1/index.html",
          launchMethod: "AnyWindow",
          moveOn: "NotApplicable",
          extensions: [],
        },
      ],
      extensions: [],
    });
  });

  it("removes the white space of XML that leads and trails each value but moveOn and launchMethod, and keeps a no-break space", () => {
    const xml = structure(
      au(
        'id=" https://example.org/au/1\n" masteryScore=" 1.0 " activityType="\thttps://example.org/types/a "',
        "<url>\n  https://example.org/au/1/index.html\n</url><launchParameters>  a=1  </launchParameters>",
      ),
      {
        courseInner:
          '<title><langstring lang=" en ">\n  A title\n  in two lines  </langstring></title><description><langstring> D</langstring></description>',
      },
    );
    const read = readCourseStructure(xml);
    expect(read.course.title).toStrictEqual([{ lang: "en", text: "A title\n  in two lines" }]);
    expect(read.course.description).toStrictEqual([{ text: " D" }]);
    expect(read.children[0]).toMatchObject({
      id: "https://example.org/au/1",
      masteryScore: 1,
      activityType: "https://example.org/types/a",
      url: "https://example.org/au/1/index.html",
      launchParameters: "a=1",
    });
  });

  it("reads text in CDATA sections and character references, and passes over comments and processing instructions", () => {
    const xml = structure(au(), {
      courseInner: `<!-- a comment --><?pi data?><title><langstring><![CDATA[A & <b>]]> &#x263A;&amp;</langstring></title><description><langstring>D</langstring></description>`,
    });
    expect(readCourseStructure(xml).course.title).toStrictEqual([{ text: "A & <b> ☺&" }]);
  });

  it("reads bytes in UTF-8, with or without a byte order mark, and in UTF-16 with one", () => {
    const xml = structure(au(), { courseInner: TEXTS.replace(">T<", ">Title ☺ 𝄞 é<") });
    const expected = readCourseStructure(xml);
    const utf8 = new TextEncoder().encode(xml);
    const utf16 = (littleEndian: boolean) => {
      const text = xml.replace('encoding="utf-8"', 'encoding="UTF-16"');
      const bytes = new Uint8Array(2 + text.length * 2);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 0xfeff, littleEndian);
      for (let index = 0; index < text.length; index += 1)
        view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian);
      return bytes;
    };
    expect(readCourseStructure(utf8)).toStrictEqual(expected);
    expect(readCourseStructure(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toStrictEqual(expected);
    expect(readCourseStructure(utf16(true))).toStrictEqual(expected);
    expect(readCourseStructure(utf16(false))).toStrictEqual(expected);
    expect(readCourseStructure(`﻿${xml}`)).toStrictEqual(expected);
  });

  it("refuses bytes that are not valid in their encoding, and a declaration of an encoding the structure is not in", () => {
    const xml = structure();
    expect(() => readCourseStructure(new Uint8Array([0x3c, 0xff, 0x3e]))).toThrow(
      new DataError("The course structure is not valid UTF-8: its bytes cannot be decoded."),
    );
    for (const declared of ["ISO-8859-1", "UTF-16"]) {
      const bytes = new TextEncoder().encode(xml.replace('encoding="utf-8"', `encoding="${declared}"`));
      expect(() => validateCourseStructure(bytes)).toThrow(DataError);
    }
    expect(() => readCourseStructure(xml.replace('encoding="utf-8"', 'encoding="windows-1252"'))).toThrow(
      'The course structure declares the encoding "windows-1252", and it may declare UTF-8 or UTF-16: write it in UTF-8 and declare that.',
    );
    for (const declared of ["UTF-8", "utf-16", "UTF-16BE"]) {
      expect(validateCourseStructure(xml.replace('encoding="utf-8"', `encoding="${declared}"`))).toStrictEqual([]);
    }
    expect(validateCourseStructure(xml.replace(' encoding="utf-8"', ""))).toStrictEqual([]);
  });

  it("returns a model that shares nothing with what it read, and the same model from the same text", () => {
    const xml = structure();
    const first = readCourseStructure(xml);
    expect(readCourseStructure(xml)).toStrictEqual(first);
    expect(readCourseStructure(xml)).not.toBe(first);
  });

  it("throws a DataError that names the path of the first error and counts the others", () => {
    const xml = withUnit('moveOn="Sometimes" launchMethod="Elsewhere"');
    expect(() => readCourseStructure(xml)).toThrow(
      new DataError(
        'The course structure is invalid at children[0].moveOn: "Sometimes" is not one of Passed, Completed, CompletedAndPassed, CompletedOrPassed, NotApplicable. 1 more error: validateCourseStructure lists every finding.',
      ),
    );
  });
});

describe("the extensions of a course structure", () => {
  it("keeps an element of another namespace of the structure, the course, a block and an assignable unit as written, with the namespaces it uses", () => {
    const xml = structure(
      `${block("https://example.org/blocks/1", `${au()}<v:b xmlns:v="urn:v">block</v:b>`)}<v:s>the <!-- c --> structure</v:s>`,
      {
        root: ' xmlns:v="urn:v" xmlns:w="urn:w"',
        courseInner: `${TEXTS}<v:c w:a="1"><langstring>cmi5 inside</langstring><w:d/></v:c>`,
      },
    ).replace(
      "<url>https://example.org/au/1/index.html</url>",
      '<url>https://example.org/au/1/index.html</url><w:u\n  xmlns:w="urn:other"/>',
    );
    const read = readCourseStructure(xml);
    expect(read.course.extensions).toStrictEqual([
      {
        namespace: "urn:v",
        name: "c",
        xml: `<v:c xmlns:v="urn:v" xmlns:w="urn:w" xmlns="${NAMESPACE}" w:a="1"><langstring>cmi5 inside</langstring><w:d/></v:c>`,
      },
    ]);
    const [member] = read.children;
    expect(member?.kind === "block" && member.extensions).toStrictEqual([
      { namespace: "urn:v", name: "b", xml: '<v:b xmlns:v="urn:v">block</v:b>' },
    ]);
    expect(member?.kind === "block" && member.children[0]?.extensions).toStrictEqual([
      { namespace: "urn:other", name: "u", xml: '<w:u\n  xmlns:w="urn:other"/>' },
    ]);
    expect(read.extensions).toStrictEqual([
      { namespace: "urn:v", name: "s", xml: '<v:s xmlns:v="urn:v">the <!-- c --> structure</v:s>' },
    ]);
  });

  it("declares no namespace that an extension does not use from around it: none for xml, nor for a default of none", () => {
    const xml = `<?xml version="1.0"?><c:courseStructure xmlns:c="${NAMESPACE}" xmlns:v="urn:v"><c:course id="https://example.org/course"><c:title><c:langstring>T</c:langstring></c:title><c:description><c:langstring>D</c:langstring></c:description><v:x xml:lang="en"><y/></v:x></c:course><c:au id="https://example.org/au/1"><c:title><c:langstring>T</c:langstring></c:title><c:description><c:langstring>D</c:langstring></c:description><c:url>https://example.org/a</c:url></c:au></c:courseStructure>`;
    expect(readCourseStructure(xml).course.extensions).toStrictEqual([
      { namespace: "urn:v", name: "x", xml: '<v:x xmlns:v="urn:v" xml:lang="en"><y/></v:x>' },
    ]);
  });

  it("checks the elements and attributes of another namespace elsewhere where the schema allows them, and drops them", () => {
    const xml = structure(
      `<objectives xmlns:v="urn:v" v:a="1">${OBJECTIVE}<v:o/></objectives>${au('id="https://example.org/au/1" v:a="1"', '<objectives><objective idref="https://example.org/objectives/1"/><v:r/></objectives><url>https://example.org/au/1/index.html</url>')}`,
      {
        root: ' xmlns:v="urn:v" v:a="1"',
        courseInner:
          '<title v:a="1"><langstring v:a="1">T</langstring><v:t/></title><description><langstring>D</langstring></description>',
      },
    );
    const read = readCourseStructure(xml);
    expect(read.course).toStrictEqual({
      id: "https://example.org/course",
      title: [{ text: "T" }],
      description: [{ text: "D" }],
      extensions: [],
    });
    expect(read.objectives).toHaveLength(1);
    expect(read.children[0]).toMatchObject({ objectives: ["https://example.org/objectives/1"], extensions: [] });
  });
});

describe("the rules of the schema", () => {
  const Prelude = `<?xml version="1.0"?><courseStructure xmlns="${NAMESPACE}">`;
  const Course = `<course id="https://example.org/course">${TEXTS}</course>`;
  it.each([
    [
      "a course without its description",
      structure(au(), { courseInner: TEXTS.replace(/<description>.*<\/description>/u, "") }),
      "course",
      "missing-element",
    ],
    [
      "a title without a langstring",
      structure(au(), { courseInner: TEXTS.replace(/<langstring[^/]*\/langstring>/u, "") }),
      "course.title",
      "missing-element",
    ],
    ["no course", `${Prelude}${au()}</courseStructure>`, "", "missing-element"],
    ["no assignable unit or block", `${Prelude}${Course}</courseStructure>`, "", "missing-element"],
    [
      "a block without members",
      structure(`<block id="https://example.org/b">${TEXTS}</block>`),
      "children[0]",
      "missing-element",
    ],
    ["an assignable unit without a url", withUnit("", ""), "children[0]", "missing-element"],
    [
      "an extension before the url",
      withUnit("", '<v:x xmlns:v="urn:v"/><url>https://example.org/a</url>'),
      "children[0]",
      "missing-element",
    ],
    [
      "two titles",
      structure(au(), { courseInner: `${TEXTS}${TEXTS.slice(0, TEXTS.indexOf("<description>"))}` }),
      "course",
      "unexpected-element",
    ],
    [
      "objectives after the members",
      `${Prelude}${Course}${au()}<objectives>${OBJECTIVE}</objectives></courseStructure>`,
      "",
      "unexpected-element",
    ],
    [
      "entitlementKey before launchParameters",
      withUnit(
        "",
        "<url>https://example.org/a</url><entitlementKey>e</entitlementKey><launchParameters>p</launchParameters>",
      ),
      "children[0]",
      "unexpected-element",
    ],
    [
      "an element of cmi5 that the schema does not have",
      withUnit("", "<url>https://example.org/a</url><note/>"),
      "children[0]",
      "unexpected-element",
    ],
    [
      "an element of no namespace",
      withUnit("", '<url>https://example.org/a</url><note xmlns=""/>'),
      "children[0]",
      "unexpected-element",
    ],
    [
      "an element in a langstring",
      structure(au(), { courseInner: TEXTS.replace(">T<", '>T<v:x xmlns:v="urn:v"/><') }),
      "course.title[0]",
      "unexpected-element",
    ],
    [
      "an element in the url",
      withUnit("", '<url>https://example.org/a<v:x xmlns:v="urn:v"/></url>'),
      "children[0].url",
      "unexpected-element",
    ],
    [
      "an extension in an objective",
      structure(
        `<objectives><objective id="https://example.org/o">${TEXTS}<v:x xmlns:v="urn:v"/></objective></objectives>${au()}`,
      ),
      "objectives[0]",
      "unexpected-element",
    ],
    [
      "two titles of an objective",
      structure(
        `<objectives><objective id="https://example.org/o">${TEXTS}<title><langstring>T</langstring></title></objective></objectives>${au()}`,
      ),
      "objectives[0]",
      "unexpected-element",
    ],
    [
      "an objective without its title",
      structure(
        `<objectives><objective id="https://example.org/o"><description><langstring>D</langstring></description></objective></objectives>${au()}`,
      ),
      "objectives[0]",
      "missing-element",
    ],
    [
      "an element in an objective reference",
      structure(
        `<objectives>${OBJECTIVE}</objectives>${au(undefined, '<objectives><objective idref="https://example.org/objectives/1"><x/></objective></objectives><url>https://example.org/a</url>')}`,
      ),
      "children[0].objectives[0]",
      "unexpected-element",
    ],
    ["text among elements", withUnit("", "<url>https://example.org/a</url>stray"), "children[0]", "unexpected-text"],
    [
      "white space in an objective reference",
      structure(
        `<objectives>${OBJECTIVE}</objectives>${au(undefined, '<objectives><objective idref="https://example.org/objectives/1"> </objective></objectives><url>https://example.org/a</url>')}`,
      ),
      "children[0].objectives[0]",
      "unexpected-text",
    ],
    [
      "an attribute of no namespace that the element does not have",
      withUnit('color="red"'),
      "children[0]",
      "unexpected-attribute",
    ],
    [
      "an attribute of the namespace of cmi5",
      withUnit(`xmlns:c="${NAMESPACE}" c:moveOn="Passed"`),
      "children[0]",
      "unexpected-attribute",
    ],
    [
      "an attribute of another namespace on the url",
      withUnit("", '<url xml:lang="en">https://example.org/a</url>'),
      "children[0].url",
      "unexpected-attribute",
    ],
    [
      "an attribute of another namespace on an objective",
      structure(
        `<objectives><objective xmlns:v="urn:v" v:a="1" id="https://example.org/o">${TEXTS}</objective></objectives>${au()}`,
      ),
      "objectives[0]",
      "unexpected-attribute",
    ],
    ["a course without its id", structure(au(), { course: "" }), "course", "missing-attribute"],
    ["a moveOn of another value", withUnit('moveOn="Sometimes"'), "children[0].moveOn", "enumeration"],
    [
      "a moveOn with white space, which the schema compares as written",
      withUnit('moveOn=" Passed "'),
      "children[0].moveOn",
      "enumeration",
    ],
    [
      "a launchMethod with white space",
      withUnit('launchMethod="OwnWindow "'),
      "children[0].launchMethod",
      "enumeration",
    ],
    ["a masteryScore above 1", withUnit('masteryScore="1.5"'), "children[0].masteryScore", "mastery-score"],
    ["a masteryScore below 0", withUnit('masteryScore="-0.1"'), "children[0].masteryScore", "mastery-score"],
    ["a masteryScore with an exponent", withUnit('masteryScore="1e-1"'), "children[0].masteryScore", "mastery-score"],
    ["an empty masteryScore", withUnit('masteryScore=""'), "children[0].masteryScore", "mastery-score"],
    [
      "a lang with an underscore",
      structure(au(), { courseInner: TEXTS.replace('lang="en"', 'lang="en_US"') }),
      "course.title[0].lang",
      "language",
    ],
    [
      "an empty lang",
      structure(au(), { courseInner: TEXTS.replace('lang="en"', 'lang=""') }),
      "course.title[0].lang",
      "language",
    ],
    ["an empty url", withUrl(" "), "children[0].url", "url-empty"],
  ])("finds %s", (_title, xml, path, rule) => {
    expect(firstFinding(xml)).toStrictEqual({ path, rule });
  });

  it("takes what the schema allows: decimals of every form, moveOn and launchMethod of each value, and a lang of up to eight letters", () => {
    for (const score of ["0", "1", "1.", ".5", "+0.5", "-0", "0.80000", "1.0000000"]) {
      expect(validateCourseStructure(withUnit(`masteryScore="${score}"`))).toStrictEqual([]);
    }
    for (const value of ["Passed", "Completed", "CompletedAndPassed", "CompletedOrPassed", "NotApplicable"]) {
      expect(validateCourseStructure(withUnit(`moveOn="${value}" launchMethod="AnyWindow"`))).toStrictEqual([]);
    }
    expect(readCourseStructure(withUnit('masteryScore="-0"')).children[0]).toMatchObject({ masteryScore: 0 });
    expect(
      Object.is(
        (readCourseStructure(withUnit('masteryScore="-0"')).children[0] as { masteryScore: number }).masteryScore,
        0,
      ),
    ).toBe(true);
    expect(
      validateCourseStructure(structure(au(), { courseInner: TEXTS.replace('lang="en"', 'lang="abcdefgh-x1"') })),
    ).toStrictEqual([]);
  });

  it("lists every missing element, attribute and value, in the order of the document", () => {
    const xml = `<?xml version="1.0"?><courseStructure xmlns="${NAMESPACE}"><course><title/></course><au moveOn="x"><url/></au></courseStructure>`;
    expect(validateCourseStructure(xml).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "course missing-attribute",
      "course.title missing-element",
      "course missing-element",
      "children[0] missing-attribute",
      "children[0].moveOn enumeration",
      "children[0] missing-element",
      "children[0] missing-element",
      "children[0].url url-empty",
    ]);
  });
});

describe("the rules of cmi5 beyond the schema", () => {
  it.each([
    ["a course id that is not fully qualified", structure(au(), { course: 'id="w3id.org/course"' }), "course.id"],
    ["an empty block id", structure(block("", au())), "children[0].id"],
    ["an assignable unit id with a space", structure(au('id="not a uri"')), "children[0].id"],
    [
      "an objective id that is relative",
      structure(`<objectives><objective id="objectives/1">${TEXTS}</objective></objectives>${au()}`),
      "objectives[0].id",
    ],
    ["an activityType that is no IRI", withUnit('activityType="media"'), "children[0].activityType"],
    [
      "an idref that is no IRI",
      structure(
        `<objectives><objective id="o:1">${TEXTS}</objective></objectives>${au(undefined, '<objectives><objective idref="o 1"/></objectives><url>https://example.org/a</url>')}`,
      ),
      "children[0].objectives[0].idref",
    ],
  ])("refuses %s, as an IRI must be fully qualified", (_title, xml, path) => {
    expect(firstFinding(xml)).toStrictEqual({ path, rule: "iri" });
  });

  it("refuses two blocks, two objectives or two assignable units with one id, and takes one id for members of different kinds", () => {
    const id = "https://example.org/shared";
    expect(firstFinding(structure(`${au(`id="${id}"`)}${au(`id=" ${id} "`)}`))).toStrictEqual({
      path: "children[1].id",
      rule: "duplicate-id",
    });
    expect(
      firstFinding(structure(`${block(id, au())}${block(id, au('id="https://example.org/au/2"'))}`)),
    ).toStrictEqual({
      path: "children[1].id",
      rule: "duplicate-id",
    });
    expect(firstFinding(structure(`<objectives>${OBJECTIVE}${OBJECTIVE}</objectives>${au()}`))).toStrictEqual({
      path: "objectives[1].id",
      rule: "duplicate-id",
    });
    expect(
      validateCourseStructure(
        structure(`<objectives><objective id="${id}">${TEXTS}</objective></objectives>${block(id, au(`id="${id}"`))}`),
      ),
    ).toStrictEqual([]);
    expect(validateCourseStructure(structure(`${au(`id="${id}"`)}${au(`id="${id}"`)}`))[0]?.message).toBe(
      '"https://example.org/shared" is the id of children[0] too: each assignable unit needs an id of its own.',
    );
  });

  it("refuses an objective reference that names no objective of the structure, or names none at all", () => {
    const reference = (attributes: string) =>
      structure(
        `<objectives>${OBJECTIVE}</objectives>${block("https://example.org/b", `<objectives><objective ${attributes}/></objectives>${au()}`)}`,
      );
    expect(firstFinding(reference('idref="https://example.org/objectives/2"'))).toStrictEqual({
      path: "children[0].objectives[0].idref",
      rule: "objective-reference",
    });
    expect(firstFinding(reference(""))).toStrictEqual({ path: "children[0].objectives[0]", rule: "missing-attribute" });
    expect(validateCourseStructure(reference('idref=" https://example.org/objectives/1 "'))).toStrictEqual([]);
  });

  it("refuses a mastery score with more than 4 decimal places that are not trailing zeros", () => {
    expect(firstFinding(withUnit('masteryScore="0.12345"'))).toStrictEqual({
      path: "children[0].masteryScore",
      rule: "mastery-score",
    });
    expect(validateCourseStructure(withUnit('masteryScore="0.1234000"'))).toStrictEqual([]);
  });

  it("refuses an element or an attribute in launchParameters and entitlementKey, which cmi5 types as text", () => {
    expect(
      firstFinding(
        withUnit("", '<url>https://example.org/a</url><launchParameters>a=1<v:x xmlns:v="urn:v"/></launchParameters>'),
      ),
    ).toStrictEqual({
      path: "children[0].launchParameters",
      rule: "unexpected-element",
    });
    expect(
      firstFinding(withUnit("", '<url>https://example.org/a</url><entitlementKey a="1">x</entitlementKey>')),
    ).toStrictEqual({
      path: "children[0].entitlementKey",
      rule: "unexpected-attribute",
    });
  });
});

describe("the URL of an assignable unit", () => {
  it.each([
    ["a space", "https://example.org/a b.html", "url-characters"],
    ["a tilde, which RFC 1738 calls unsafe", "https://example.org/~a/index.html", "url-characters"],
    ["a character beyond ASCII", "https://example.org/café.html", "url-characters"],
    ["a % without two hexadecimal digits", "https://example.org/a%2.html", "url-characters"],
    ["two fragments", "https://example.org/a.html#x#y", "url-characters"],
    ["a scheme that runs code", "javascript://%0aalert(1)", "url-scheme"],
    ["a data URL", "data:text/html,x", "url-scheme"],
    ["a scheme without //", "https:example.org/a.html", "url-scheme"],
    ["a relative URL outside a package", "index.html", "url-relative"],
    ["a URL whose query names endpoint", "https://example.org/a.html?endpoint=https://evil.example/", "url-query"],
    [
      "a URL whose query names fetch in another case",
      "https://example.org/a.html?x=1&amp;FETCH=https://evil.example/",
      "url-query",
    ],
    ["a URL whose query names actor encoded", "https://example.org/a.html?%61ctor=x", "url-query"],
    ["a URL whose query names activityId", "https://example.org/a.html?activityid=x", "url-query"],
    ["a URL whose query names registration", "https://example.org/a.html?registration", "url-query"],
  ])("refuses %s", (_title, url, rule) => {
    expect(firstFinding(withUrl(url))).toStrictEqual({ path: "children[0].url", rule });
  });

  it.each([
    ["an absolute path", "/index.html"],
    ["a network path", "//example.org/index.html"],
    ["a path that leaves the root", "a/../../index.html"],
    ["a path that leaves the root encoded", "%2e%2e/index.html"],
  ])("refuses %s in a package", (_title, url) => {
    expect(firstFinding(withUrl(url), { packaged: true })).toStrictEqual({
      path: "children[0].url",
      rule: "url-relative",
    });
  });

  it("takes a fully qualified URL of an allowed scheme, a fragment, a query of other names, and a relative path in a package", () => {
    for (const url of [
      "https://example.org/a.html",
      "HTTP://example.org:8080/a;p?x=1&amp;y=$,+!*'()@:#/start",
      "https://example.org/a.html?endpoints=1&amp;fetching=2",
      "https://example.org/caf%C3%A9.html",
    ]) {
      expect(validateCourseStructure(withUrl(url))).toStrictEqual([]);
    }
    for (const url of ["index.html", "a/./b/../index.html?x=1#y", "./index.html", "a/%FF.html"]) {
      expect(validateCourseStructure(withUrl(url), { packaged: true })).toStrictEqual([]);
    }
  });

  it("takes the schemes that the host names, each followed by //", () => {
    expect(validateCourseStructure(withUrl("myapp://course/1"), { launchSchemes: ["myapp"] })).toStrictEqual([]);
    expect(firstFinding(withUrl("https://example.org/a.html"), { launchSchemes: ["myapp"] })).toStrictEqual({
      path: "children[0].url",
      rule: "url-scheme",
    });
    expect(validateCourseStructure(withUrl("javascript://x"), { launchSchemes: ["myapp"] })[0]?.message).toBe(
      '"javascript://x" does not start with a scheme that the LMS launches followed by ://: use one of myapp.',
    );
  });
});

describe("what ends the reading", () => {
  it("finds a structure that is not well-formed, and reads no further", () => {
    for (const xml of [
      "",
      "<courseStructure",
      `${structure()}trailing`,
      "<a:b/>",
      `${structure()}<courseStructure/>`,
    ]) {
      const findings = validateCourseStructure(xml);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ path: "", rule: "well-formed", severity: "error" });
    }
    expect(validateCourseStructure(structure().replace("</course>", "")).map(({ rule }) => rule)).toStrictEqual([
      "unexpected-element",
      "well-formed",
    ]);
  });

  it("refuses a DOCTYPE, so that no entity is declared or expanded", () => {
    const xml = structure().replace(
      "<courseStructure",
      '<!DOCTYPE courseStructure [<!ENTITY e "x">]>\n<courseStructure',
    );
    expect(validateCourseStructure(xml)).toStrictEqual([
      {
        path: "",
        rule: "doctype",
        message: "has a DOCTYPE, which a course structure may not have.",
        severity: "error",
      },
    ]);
    expect(() => readCourseStructure(xml)).toThrow(
      "The course structure is invalid: has a DOCTYPE, which a course structure may not have.",
    );
  });

  it("refuses a root other than the courseStructure of cmi5", () => {
    for (const xml of [structure().replace(` xmlns="${NAMESPACE}"`, ""), `<course xmlns="${NAMESPACE}"/>`]) {
      expect(validateCourseStructure(xml).map(({ rule }) => rule)).toStrictEqual(["root"]);
    }
  });
});

describe("the limits of reading", () => {
  it("refuses a structure above maxBytes, counted in UTF-8 for a string, before it is parsed", () => {
    const xml = structure();
    const bytes = new TextEncoder().encode(xml).byteLength;
    expect(validateCourseStructure(xml, { maxBytes: bytes })).toStrictEqual([]);
    expect(() => validateCourseStructure(xml, { maxBytes: bytes - 1 })).toThrow(
      new DataError(`The course structure has more than ${bytes - 1} bytes, the limit of the option maxBytes.`),
    );
    expect(() => validateCourseStructure(new TextEncoder().encode(xml), { maxBytes: bytes - 1 })).toThrow(
      new DataError(
        `The course structure has ${bytes} bytes, above the limit of ${bytes - 1} bytes of the option maxBytes.`,
      ),
    );
    // A lone surrogate is three bytes, as TextEncoder writes it, and then a character that XML does not take.
    for (const text of [">é☺𝄞<", ">\ud800<", ">\udc00x<"]) {
      const wide = structure(au(), { courseInner: TEXTS.replace(">T<", text) });
      const wideBytes = new TextEncoder().encode(wide).byteLength;
      expect(() => validateCourseStructure(wide, { maxBytes: wideBytes })).not.toThrow();
      expect(() => validateCourseStructure(wide, { maxBytes: wideBytes - 1 })).toThrow(DataError);
    }
  });

  it("refuses a structure that nests deeper than maxDepth", () => {
    expect(validateCourseStructure(structure(), { maxDepth: 4 })).toStrictEqual([]);
    expect(() => validateCourseStructure(structure(), { maxDepth: 3 })).toThrow(
      new DataError("The course structure nests more than 3 elements, the limit of the option maxDepth."),
    );
  });

  it("refuses a structure with more elements and attributes than maxElements, namespace declarations included", () => {
    const xml = structure();
    const count = (xml.match(/<[a-zA-Z]/gu) ?? []).length + (xml.match(/=/gu) ?? []).length - 2;
    expect(validateCourseStructure(xml, { maxElements: count })).toStrictEqual([]);
    expect(() => validateCourseStructure(xml, { maxElements: count - 1 })).toThrow(
      new DataError(
        `The course structure has more than ${count - 1} elements and attributes, the limit of the option maxElements.`,
      ),
    );
  });

  it("lists at most maxFindings, and a last finding that says the list stopped", () => {
    const xml = structure(Array.from({ length: 5 }, () => au('id="x"')).join(""));
    expect(validateCourseStructure(xml)).toHaveLength(9);
    const findings = validateCourseStructure(xml, { maxFindings: 3 });
    expect(findings.map(({ rule }) => rule)).toStrictEqual(["iri", "iri", "duplicate-id", "findings-stopped"]);
    expect(() => readCourseStructure(xml, { maxFindings: 1 })).toThrow(
      'The course structure is invalid at children[0].id: "x" is not a fully qualified IRI. There may be more errors: the check stopped at its limit, and validateCourseStructure with a higher maxFindings lists more.',
    );
  });

  it("stops at maxFindings in the check of the objective references too", () => {
    const references = Array.from(
      { length: 3 },
      (_, index) => `<objective idref="https://example.org/o/${index}"/>`,
    ).join("");
    const xml = structure(au(undefined, `<objectives>${references}</objectives><url>https://example.org/a</url>`));
    expect(validateCourseStructure(xml, { maxFindings: 2 }).map(({ rule }) => rule)).toStrictEqual([
      "objective-reference",
      "objective-reference",
      "findings-stopped",
    ]);
  });
});

describe("the arguments of reading", () => {
  it("throws a DataError for a structure that is neither a string nor bytes", () => {
    for (const value of JSON.parse("[null, 5, {}, [], true]")) {
      expect(() => readCourseStructure(value)).toThrow(DataError);
      expect(() => validateCourseStructure(value)).toThrow(
        /^The course structure must be a string or a Uint8Array, found /u,
      );
    }
  });

  it("throws a DataError that names an option that is not valid", () => {
    const xml = structure();
    expect(() => readCourseStructure(xml, JSON.parse("null"))).toThrow(
      "The options object is invalid: expected an object, found null.",
    );
    for (const [options, sentence] of [
      [{ maxBytes: 0 }, "The options object is invalid at maxBytes"],
      [{ maxDepth: "64" }, "The options object is invalid at maxDepth"],
      [{ maxElements: 1.5 }, "The options object is invalid at maxElements"],
      [{ maxFindings: -1 }, "The options object is invalid at maxFindings"],
      [{ packaged: "yes" }, "The options object is invalid at packaged"],
      [{ launchSchemes: [] }, "The options object is invalid at launchSchemes"],
      [{ launchSchemes: "https" }, "The options object is invalid at launchSchemes"],
      [
        { launchSchemes: ["HTTPS"] },
        'The options object is invalid at launchSchemes[0]: expected a scheme in lower case, found "HTTPS".',
      ],
      [
        { launchSchemes: ["https", "javascript"] },
        'The options object is invalid at launchSchemes[1]: expected a scheme that runs no code and reaches no local data, found "javascript".',
      ],
      [{ launchSchemes: ["data"] }, "The options object is invalid at launchSchemes[0]"],
      [{ strict: true }, 'The options object is invalid: unexpected property "strict".'],
    ] as const) {
      expect(() => validateCourseStructure(xml, options as never)).toThrow(sentence);
    }
  });
});

describe("writing a course structure", () => {
  const full: CourseStructure = readCourseStructure(
    structure(
      `<objectives>${OBJECTIVE}</objectives>${block(
        "https://example.org/blocks/1",
        `<objectives><objective idref="https://example.org/objectives/1"/></objectives>${au(
          'id="https://example.org/au/1" moveOn="Passed" masteryScore="0.8" launchMethod="OwnWindow" activityType="https://example.org/types/a"',
          '<url>index.html?a=1&amp;b=2</url><launchParameters>&lt;p&gt; &amp; "q"</launchParameters><entitlementKey/><v:x xmlns:v="urn:v">1</v:x>',
        )}`,
      )}<v:s xmlns:v="urn:v"/>`,
      {
        courseInner: `<title><langstring>A &lt;title&gt;</langstring><langstring lang="fr">Un titre</langstring></title><description><langstring>D</langstring></description><v:c xmlns:v="urn:v"/>`,
      },
    ),
    { packaged: true },
  );

  it("writes what the reader reads back as the same model", () => {
    const xml = writeCourseStructure(full);
    expect(readCourseStructure(xml, { packaged: true })).toStrictEqual(full);
    expect(writeCourseStructure(readCourseStructure(xml, { packaged: true }))).toBe(xml);
  });

  it("writes UTF-8 with the namespace of cmi5, each element on a line of its own, and every attribute of an assignable unit", () => {
    const xml = writeCourseStructure(readCourseStructure(structure()));
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        `<courseStructure xmlns="${NAMESPACE}">`,
        '  <course id="https://example.org/course">',
        "    <title>",
        '      <langstring lang="en">T</langstring>',
        "    </title>",
        "    <description>",
        '      <langstring lang="en">D</langstring>',
        "    </description>",
        "  </course>",
        '  <au id="https://example.org/au/1" moveOn="NotApplicable" launchMethod="AnyWindow">',
        "    <title>",
        '      <langstring lang="en">T</langstring>',
        "    </title>",
        "    <description>",
        '      <langstring lang="en">D</langstring>',
        "    </description>",
        "    <url>https://example.org/au/1/index.html</url>",
        "  </au>",
        "</courseStructure>",
        "",
      ].join("\n"),
    );
  });

  it("escapes what XML needs escaped, carriage returns and tabs of attributes included", () => {
    const unit = full.children[0]?.kind === "block" ? full.children[0].children[0] : undefined;
    const changed = {
      ...full,
      course: { ...full.course, title: [{ text: "a\r\nb <c> & d" }] },
      objectives: [{ ...full.objectives[0], id: 'https://example.org/o?a="1"&b=<2>' }],
      children: unit === undefined ? [] : [{ ...unit, objectives: [] }],
    } as CourseStructure;
    const xml = writeCourseStructure(changed);
    expect(xml).toContain("<langstring>a&#13;\nb &lt;c&gt; &amp; d</langstring>");
    expect(xml).toContain('<objective id="https://example.org/o?a=&quot;1&quot;&amp;b=&lt;2>">');
  });

  it("refuses a structure that breaks a rule of cmi5, with the path of the reader", () => {
    const unit = {
      ...(full.children[0]?.kind === "block" ? full.children[0].children[0] : undefined),
      url: "../index.html",
    };
    expect(() => writeCourseStructure({ ...full, children: [unit] } as CourseStructure)).toThrow(
      /^The course structure is invalid at children\[0\]\.url: "\.\.\/index\.html" does not name a file below the root/u,
    );
    expect(() => writeCourseStructure({ ...full, children: [] })).toThrow(
      "The course structure is invalid: has no <au> or <block>.",
    );
    expect(() => writeCourseStructure({ ...full, course: { ...full.course, id: "course" } })).toThrow("at course.id");
  });

  it("refuses a value of the wrong type with its path", () => {
    for (const [value, sentence] of [
      [null, "The course structure is invalid: expected an object, found null."],
      [{ ...full, course: null }, "The course structure is invalid at course"],
      [{ ...full, children: [{ kind: "au" }] }, "The course structure is invalid at children[0]"],
      [
        { ...full, children: [{ kind: "block", children: [{ kind: "lesson" }] }] },
        "The course structure is invalid at children[0]",
      ],
      [{ ...full, objectives: "none" }, "The course structure is invalid at objectives"],
      [{ ...full, extra: 1 }, 'The course structure is invalid: unexpected property "extra".'],
    ] as const) {
      expect(() => writeCourseStructure(JSON.parse(JSON.stringify(value)))).toThrow(sentence);
    }
    const unit = full.children[0]?.kind === "block" ? full.children[0].children[0] : undefined;
    expect(() => writeCourseStructure({ ...full, children: [{ ...unit, masteryScore: Number.NaN }] } as never)).toThrow(
      "at children[0].masteryScore",
    );
  });

  it("refuses text that XML 1.0 cannot hold", () => {
    for (const text of ["a\u0000b", "\u0007", "\ud800", "￿"]) {
      expect(() => writeCourseStructure({ ...full, course: { ...full.course, title: [{ text }] } })).toThrow(
        "The course structure is invalid at course.title[0].text: expected text that XML 1.0 can hold, without control characters or lone surrogates",
      );
    }
  });

  it("refuses blocks nested deeper than a structure may be, before it reads them", () => {
    let member: unknown = full.children[0];
    for (let level = 0; level < 100_000; level += 1) member = { kind: "block", children: [member] };
    expect(() => writeCourseStructure({ ...full, children: [member] } as CourseStructure)).toThrow(
      new DataError("The course structure nests blocks more than 64 deep, the most that it may."),
    );
  });

  it.each([
    [
      "the namespace of cmi5",
      { namespace: NAMESPACE, name: "x", xml: `<x xmlns="${NAMESPACE}"/>` },
      'has the namespace "https://w3id.org',
    ],
    ["no namespace", { namespace: "", name: "x", xml: "<x/>" }, 'has the namespace ""'],
    [
      "text before the element",
      { namespace: "urn:v", name: "x", xml: ' <x xmlns="urn:v"/>' },
      "does not start with its element",
    ],
    [
      "an XML declaration",
      { namespace: "urn:v", name: "x", xml: '<?xml version="1.0"?><x xmlns="urn:v"/>' },
      "does not start with its element",
    ],
    [
      "a comment before the element",
      { namespace: "urn:v", name: "x", xml: '<!-- c --><x xmlns="urn:v"/>' },
      "does not start with its element",
    ],
    [
      "a comment after the element",
      { namespace: "urn:v", name: "x", xml: '<x xmlns="urn:v"/><!-- c -->' },
      "holds something after its element",
    ],
    [
      "two elements",
      { namespace: "urn:v", name: "x", xml: '<x xmlns="urn:v"/><x xmlns="urn:v"/>' },
      "is not well-formed XML",
    ],
    [
      "another name",
      { namespace: "urn:v", name: "x", xml: '<y xmlns="urn:v"/>' },
      'is the element <y> of "urn:v", not <x> of "urn:v".',
    ],
    [
      "another namespace",
      { namespace: "urn:v", name: "x", xml: '<x xmlns="urn:w"/>' },
      'is the element <x> of "urn:w", not <x> of "urn:v".',
    ],
    [
      "an element of no namespace inside",
      { namespace: "urn:v", name: "x", xml: '<v:x xmlns:v="urn:v"><y/></v:x>' },
      "holds the element <y> of no namespace",
    ],
    [
      "an unbound prefix",
      { namespace: "urn:v", name: "x", xml: '<v:x xmlns:v="urn:v"><w:y/></v:x>' },
      "is not well-formed XML",
    ],
    [
      "a DOCTYPE",
      { namespace: "urn:v", name: "x", xml: '<!DOCTYPE x><x xmlns="urn:v"/>' },
      "does not start with its element",
    ],
  ])("refuses an extension with %s", (_title, extension, sentence) => {
    expect(() => writeCourseStructure({ ...full, course: { ...full.course, extensions: [extension] } })).toThrow(
      `The extension at course.extensions[0] ${sentence}`,
    );
  });

  it("writes an extension whose elements of no namespace declare it, and checks the extensions of every member", () => {
    const extension = { namespace: "urn:v", name: "x", xml: '<v:x xmlns:v="urn:v"><y xmlns=""><z/></y></v:x>' };
    const xml = writeCourseStructure({ ...full, extensions: [extension] });
    expect(readCourseStructure(xml, { packaged: true }).extensions).toStrictEqual([extension]);
    const bad = { namespace: "urn:v", name: "x", xml: "<x/>" };
    const nested = full.children[0];
    if (nested?.kind !== "block") throw new Error("The structure of the test has a block first.");
    expect(() =>
      writeCourseStructure({
        ...full,
        children: [{ ...nested, children: [{ ...nested.children[0], extensions: [bad] } as never] }],
      }),
    ).toThrow("The extension at children[0].children[0].extensions[0]");
    expect(() => writeCourseStructure({ ...full, extensions: [bad] })).toThrow("The extension at extensions[0]");
    expect(() => writeCourseStructure({ ...full, children: [{ ...nested, extensions: [bad] }] })).toThrow(
      "The extension at children[0].extensions[0]",
    );
  });
});
