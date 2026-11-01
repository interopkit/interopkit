import { describe, expect, it } from "vitest";
import * as graph from "../src/graph/index.js";
import * as root from "../src/index.js";
import * as provider from "../src/provider/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "ASSOCIATION_TYPES",
        "CASE_VERSIONS",
        "ENTITY_KINDS",
        "FILTER_PREDICATES",
        "readEntity",
        "readPackage",
        "SERVED_KINDS",
        "SORT_ORDERS",
        "STATUS_CODES_MAJOR",
        "STATUS_CODES_MINOR",
        "STATUS_SEVERITIES",
        "toCaseVersion",
        "validateEntity",
        "validatePackage",
      ].sort(),
    );
  });

  it("exports only what the graph module documents", () => {
    expect(Object.keys(graph).sort()).toStrictEqual(
      [
        "ADOPTION_STATUSES",
        "adoptionStatus",
        "associationsOf",
        "caseEntityUri",
        "crosswalk",
        "diffPackages",
        "frameworkTree",
        "isNewer",
      ].sort(),
    );
  });

  it("exports only what the provider documents", () => {
    expect(Object.keys(provider).sort()).toStrictEqual(
      ["handleCaseRequest", "localizeOpenApi", "parseCaseQuery", "queryEntities"].sort(),
    );
  });
});
