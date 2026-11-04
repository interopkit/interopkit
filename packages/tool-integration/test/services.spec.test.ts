// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of the services are those of the specifications.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { schemaArbitrary } from "../../../scripts/schema-arbitrary.js";
import { schemaValidator } from "../../../scripts/schema-oracle.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import { httpBodyBlocks, readSpecExamples, readSpecPage } from "../../../scripts/spec-examples.js";
import {
  readContentItem,
  readControlRequest,
  readGroupContainer,
  readGroupSetContainer,
  readLineItem,
  readLineItemInput,
  readLineItems,
  readMembership,
  readPlatformConfiguration,
  readPreferencesRecord,
  readResults,
  readScore,
  readToolConfiguration,
  readToolRegistrationResult,
  writeContentItem,
  writeControlRequest,
  writeGroupContainer,
  writeGroupSetContainer,
  writeLineItem,
  writeLineItemInput,
  writeLineItems,
  writeMembership,
  writePlatformConfiguration,
  writeResults,
  writeScore,
  writeToolRegistrationResult,
} from "../src/protocol/internal.js";
import { FUZZ } from "./fuzz.js";

/**
 * The examples are those of the specifications: the open portal's AGS and NRPS, Context Groups, Dynamic Registration, Submission
 * Review, Proctoring Services and Deep Linking, and the OpenAPI files of AGS and of the AfA PNP Connector. `pnpm spec-examples`
 * and `pnpm schemas` download them at the hashes that the locks pin.
 */
const root = resolve(import.meta.dirname, "../../..");
const page = (file: string) => readSpecPage(root, file) as Record<string, unknown>[];
const examples = readSpecExamples(root);
const schemas = requireSchemas(root);
/**
 * The portal's example of a container of line items has no comma after `endDateTime` of its first line item, so that it is not
 * JSON as it is printed. The test reads it with the comma added (spec-gaps.md).
 */
const printedHtml = readFileSync(join(schemas, "lti-ags-portal.html"), "utf8");
const MISSING_COMMA = /(2018-04-06T22:05:03Z(?:"|&quot;)(?:<\/span>)?)(\s*(?:<span[^>]*>)*(?:"|&quot;)gradesReleased)/u;
const agsHtml = printedHtml.replace(MISSING_COMMA, "$1,$2");
const agsOpenApi = parse(readFileSync(join(schemas, "lti-ags-openapi.yaml"), "utf8"));
const pnpOpenApi = JSON.parse(readFileSync(join(schemas, "afapnp-openapi.json"), "utf8"));

/**
 * Turns the schema of an OpenAPI 3.0 file into JSON Schema: a boolean `exclusiveMinimum` or `exclusiveMaximum`, which OpenAPI 3.0
 * has beside `minimum` or `maximum`, becomes the number that JSON Schema draft 7 has in its place.
 */
function fromOpenApi(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(fromOpenApi);
  if (typeof node !== "object" || node === null) return node;
  const copy: Record<string, unknown> = Object.fromEntries(
    Object.entries(node).map(([key, member]) => [key, fromOpenApi(member)]),
  );
  for (const [flag, limit] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ] as const) {
    if (copy[flag] === true) {
      copy[flag] = copy[limit];
      Reflect.deleteProperty(copy, limit);
    } else if (copy[flag] === false) {
      Reflect.deleteProperty(copy, flag);
    }
  }
  return copy;
}

/** The schema that the OpenAPI file of AGS gives a body: the media type of an answer or a request of a path. */
function agsSchema(path: string, method: "get" | "post", where: "responses" | "requestBody", media: string): unknown {
  const operation = agsOpenApi.paths[path][method];
  const content = where === "requestBody" ? operation.requestBody.content : operation.responses["200"].content;
  return fromOpenApi(content[media].schema);
}
const LINE_ITEMS = "/{contextId}/lineitems";
const LINE_ITEM = "/{contextId}/lineitems/{lineItemId}";
const valid = {
  lineItemRequest: schemaValidator(
    agsSchema(LINE_ITEMS, "post", "requestBody", "application/vnd.ims.lis.v2.lineitem+json") as never,
    "7",
  ),
  lineItem: schemaValidator(
    agsSchema(LINE_ITEM, "get", "responses", "application/vnd.ims.lis.v2.lineitem+json") as never,
    "7",
  ),
  container: schemaValidator(
    agsSchema(LINE_ITEMS, "get", "responses", "application/vnd.ims.lis.v2.lineitemcontainer+json") as never,
    "7",
  ),
  results: schemaValidator(
    agsSchema(`${LINE_ITEM}/results`, "get", "responses", "application/vnd.ims.lis.v2.resultcontainer+json") as never,
    "7",
  ),
  score: schemaValidator(
    agsSchema(`${LINE_ITEM}/scores`, "post", "requestBody", "application/vnd.ims.lis.v1.score+json") as never,
    "7",
  ),
};

const bodies = httpBodyBlocks(agsHtml);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const lineItems = bodies.filter((body): body is Record<string, unknown> => isRecord(body) && "label" in body);
const containers = bodies.filter(
  (body): body is Record<string, unknown>[] =>
    Array.isArray(body) && body.length > 0 && isRecord(body[0]) && "label" in body[0],
);
const resultContainers = bodies.filter(
  (body): body is Record<string, unknown>[] =>
    Array.isArray(body) && body.length > 0 && isRecord(body[0]) && "scoreOf" in body[0],
);
const scores = bodies.filter((body): body is Record<string, unknown> => isRecord(body) && "gradingProgress" in body);

/** The mutations of a body that make the OpenAPI schema refuse it: a member taken away, or replaced by a value of another type. */
function mutations(body: Readonly<Record<string, unknown>>): Record<string, unknown>[] {
  return Object.keys(body).flatMap((name) => {
    const { [name]: _taken, ...without } = body;
    return [without, ...[{}, [], 5, "x"].map((replacement) => ({ ...body, [name]: replacement }))];
  });
}

describe("the examples of AGS", () => {
  it("are the bodies of the line item, container, result and score sections of the open portal's page", () => {
    expect([lineItems.length, containers.length, resultContainers.length, scores.length]).toEqual([5, 1, 1, 4]);
    expect(bodies.length).toBe(12);
  });

  it("validate against the OpenAPI file, are read, and are written back as they are", () => {
    for (const body of lineItems) {
      // A request that creates or replaces a line item has no id yet, and the OpenAPI file gives it a schema of its own.
      expect(("id" in body ? valid.lineItem : valid.lineItemRequest)(body), JSON.stringify(body)).toBe(true);
      if ("id" in body) expect(writeLineItem(readLineItem(body))).toEqual(body);
      else expect(writeLineItemInput(readLineItemInput(body))).toEqual(body);
    }
    for (const body of containers) {
      expect(valid.container(body)).toBe(true);
      expect(writeLineItems(readLineItems(body))).toEqual(body);
    }
    for (const body of resultContainers) {
      expect(valid.results(body)).toBe(true);
      expect(writeResults(readResults(body))).toEqual(body);
    }
    for (const body of scores) {
      expect(valid.score(body), JSON.stringify(body)).toBe(true);
      expect(writeScore(readScore(body))).toEqual(body);
    }
  });

  it("are the scores of AGS section 3.4: the one with an extension keeps it, and the one that waits for a person has four properties", () => {
    const extended = examples.scores.find((example) => Object.keys(example).length > 4) ?? {};
    expect(readScore(extended).extensions).toEqual({
      "https://www.toolexample.com/lti/score": extended["https://www.toolexample.com/lti/score"],
    });
    expect(readScore(examples.scores.find((example) => Object.keys(example).length === 4) ?? {}).gradingProgress).toBe(
      "PendingManual",
    );
  });

  it("are refused by the reader whenever the OpenAPI file refuses a change of them", () => {
    for (const body of lineItems.filter((item) => "id" in item)) {
      for (const changed of mutations(body))
        if (!valid.lineItem(changed)) expect(() => readLineItem(changed), JSON.stringify(changed)).toThrow();
    }
    for (const body of scores) {
      for (const changed of mutations(body))
        if (!valid.score(changed)) expect(() => readScore(changed), JSON.stringify(changed)).toThrow();
    }
    for (const container of resultContainers) {
      for (const [index, body] of container.entries()) {
        for (const changed of mutations(body)) {
          const all = container.map((item, at) => (at === index ? changed : item));
          if (!valid.results(all)) expect(() => readResults(all), JSON.stringify(changed)).toThrow();
        }
      }
    }
  });

  it("differ from the OpenAPI file in the properties that only the text has: activityId, gradesReleased and submissionReview", () => {
    expect(agsHtml).toContain('<h4 id="activity-id">activityId');
    expect(agsHtml).toContain('<h4 id="grades-released">gradesReleased');
    const properties = JSON.stringify(agsOpenApi.paths);
    for (const name of ["activityId", "gradesReleased", "submissionReview", "scoringUserId", "submission"])
      expect(properties).not.toContain(`"${name}"`);
    const read = readLineItem({
      id: "https://lms.example.com/li/1",
      scoreMaximum: 1,
      label: "L",
      activityId: "a",
      gradesReleased: false,
    });
    expect(read).toMatchObject({ activityId: "a", gradesReleased: false });
  });
});

describe("the examples of NRPS", () => {
  it("are read into the membership of a context and of a resource link, and written back as they are", () => {
    const [context, resourceLink] = page("lti-nrps-2p0.json").filter((block) => "members" in block);
    expect(readMembership(context).members[0]).toMatchObject({
      lti11LegacyUserId: "668321221-2879",
      givenName: "Jane",
    });
    expect(readMembership(resourceLink).members[0]?.message?.[0]).toMatchObject({
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
    });
    for (const example of [context, resourceLink]) expect(writeMembership(readMembership(example))).toEqual(example);
  });
});

describe("the examples of Context Groups", () => {
  it("are read into the groups, the groups of a user and the group sets, and written back as they are", () => {
    const blocks = page("lti-context-groups-1p0.json");
    const groups = blocks.filter((block) => "groups" in block);
    // The printed example of the group sets has no comma before "hidden", so that it is not JSON, and it is not among the blocks.
    expect(blocks.filter((block) => "sets" in block)).toHaveLength(0);
    const sets = [
      {
        id: "https://lms.example.com/class/2923/groups/sets",
        sets: [
          { id: "912cc53f-b431-447e-aff6-9d49aa9b72f2", name: "The Chemistry Lab Group Set" },
          {
            id: "6af307fc-cc7d-4867-9e6f-20c85601367a",
            name: "Course Sections",
            tag: "http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection",
          },
          { id: "02d133a7-d26e-41ec-8e63-c97fe562f0ca", name: "The Physics Lab Group Set", hidden: true },
        ],
      },
    ];
    expect(groups).toHaveLength(2);
    for (const example of groups) expect(writeGroupContainer(readGroupContainer(example))).toEqual(example);
    for (const example of sets) expect(writeGroupSetContainer(readGroupSetContainer(example))).toEqual(example);
    expect(readGroupContainer(groups[1]).userId).toBe("0ae836b9-7fc9-4060-006f-27b2066ac545");
    expect(readGroupContainer(groups[0]).groups[1]).toMatchObject({
      hidden: true,
      setIds: ["912cc53f-b431-447e-aff6-9d49aa9b72f2", "8127ccca-1d2d-496d-976c-393616ad1ff4"],
    });
  });
});

describe("the examples of Dynamic Registration", () => {
  const blocks = page("lti-dynamic-registration-1p0.json");
  const platform = blocks.find((block) => "authorization_endpoint" in block) ?? {};
  const acknowledgments = blocks.filter((block) => "client_id" in block);

  it("hold the configuration of a platform, which is read and written back as it is", () => {
    expect(readPlatformConfiguration(platform).lti.messagesSupported.length).toBeGreaterThan(0);
    expect(writePlatformConfiguration(readPlatformConfiguration(platform))).toEqual(platform);
  });

  it("hold two acknowledgments of a registration, which are read and written back as they are", () => {
    expect(acknowledgments).toHaveLength(2);
    for (const example of acknowledgments) {
      const read = readToolRegistrationResult(example);
      expect(read.clientId).toBe("709sdfnjkds12");
      expect(writeToolRegistrationResult(read)).toEqual(example);
    }
  });

  it("are refused as a request where they misspell implicit, as the specification's own example does", () => {
    const [first] = acknowledgments;
    const grantTypes = first?.grant_types;
    expect(Array.isArray(grantTypes) && grantTypes.includes("implict")).toBe(true);
    expect(() => readToolConfiguration(first)).toThrow(/implicit/u);
    const corrected = { ...first, grant_types: ["implicit", "client_credentials"] };
    expect(readToolConfiguration(corrected).grantTypes).toEqual(["implicit", "client_credentials"]);
  });
});

describe("the examples of Submission Review", () => {
  const blocks = page("lti-submission-review-1p0.json");

  it("hold line items that support review, read and written back as they are", () => {
    const items = blocks.filter((block) => "scoreMaximum" in block && !("type" in block));
    expect(items).toHaveLength(2);
    for (const item of items) expect(writeLineItemInput(readLineItemInput(item))).toEqual(item);
    expect(readLineItemInput(items[1]).submissionReview).toEqual({
      label: "Open My Tool Viewer",
      url: "https://platform.example.com/act/849023/sub",
      custom: { action: "review", a_id: "23942" },
    });
    expect(readLineItemInput(blocks.find((block) => "scoreMaximum" in block) ?? {}).submissionReview).toEqual({
      label: "Chapter 5",
    });
  });

  it("hold resource link items whose line item supports review, read and written back as they are", () => {
    const items = blocks.filter((block) => block.type === "ltiResourceLink");
    expect(items).toHaveLength(2);
    for (const item of items) expect(writeContentItem(readContentItem(item))).toEqual(item);
    expect(readContentItem(items[1])).toMatchObject({ lineItem: { submissionReview: {} } });
  });
});

describe("the example of Proctoring Services", () => {
  const request = page("lti-proctoring-1p0.json").find((block) => "action" in block) ?? {};

  it("holds a control request whose severity is a string, which is read as the number it spells", () => {
    expect(request.incident_severity).toBe("0.1");
    expect(readControlRequest(request)).toMatchObject({
      action: "flag",
      incidentSeverity: 0.1,
      attemptNumber: 1,
      reasonCode: "12056",
    });
    expect(writeControlRequest(readControlRequest(request))).toEqual({ ...request, incident_severity: 0.1 });
  });
});

describe("the content items of Deep Linking Appendix B", () => {
  const items = examples.deepLinkingResponse["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"] as Record<
    string,
    unknown
  >[];

  it("are the seven items of the five types and a type of a vendor, each read and written back as it is", () => {
    expect(items.map((item) => item.type)).toEqual([
      "link",
      "html",
      "link",
      "image",
      "ltiResourceLink",
      "file",
      "https://www.example.com/custom_type",
    ]);
    for (const item of items) expect(writeContentItem(readContentItem(item)), String(item.type)).toEqual(item);
    expect(readContentItem(items[3])).toMatchObject({
      extensions: { "https://www.example.com/resourceMetadata": { license: "CCBY4.0" } },
    });
    expect(readContentItem(items[4])).toMatchObject({
      lineItem: { scoreMaximum: 87, gradesReleased: true },
      available: { startDateTime: "2018-02-06T20:05:02Z" },
    });
  });
});

describe("the record of the AfA PNP Connector", () => {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (typeof node !== "object" || node === null) return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !key.startsWith("x-"))
        .map(([key, member]) => [
          key,
          key === "$ref" ? String(member).replace("#/components/schemas/", "#/$defs/") : strip(member),
        ]),
    );
  };
  const schema = { $ref: "#/$defs/SingleAFAPNPRecordDType", $defs: strip(pnpOpenApi.components.schemas) } as never;
  const records = schemaArbitrary(schema, { maxDepth: 3 });
  const isValid = schemaValidator(schema, "7");

  it("passes through as it is, for any record that its OpenAPI file allows", () => {
    fc.assert(
      fc.property(records, (record) => {
        expect(isValid(record)).toBe(true);
        expect(readPreferencesRecord(JSON.parse(JSON.stringify(record)))).toEqual(JSON.parse(JSON.stringify(record)));
      }),
      FUZZ,
    );
  });
});
