import { describe, expect, it } from "vitest";
import * as client from "../src/client/index.js";
import * as graph from "../src/graph/index.js";
import * as root from "../src/index.js";
import * as provider from "../src/provider/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "ASSOCIATION_TYPES",
        "CASE_VERSIONS",
        "convertCaseVersion",
        "ENTITY_KINDS",
        "FILTER_PREDICATES",
        "readEntity",
        "readPackage",
        "SERVED_KINDS",
        "SORT_ORDERS",
        "STATUS_CODES_MAJOR",
        "STATUS_CODES_MINOR",
        "STATUS_SEVERITIES",
        "validateEntity",
        "validatePackage",
      ].sort(),
    );
  });

  it("exports only what the client module documents", () => {
    expect(Object.keys(client).sort()).toStrictEqual(["writeCaseFilter", "createCaseClient"].sort());
  });

  it("exports only what the graph module documents", () => {
    expect(Object.keys(graph).sort()).toStrictEqual(
      [
        "ADOPTION_STATUSES",
        "buildEntityUri",
        "buildFrameworkTree",
        "crosswalk",
        "diffPackages",
        "isNewer",
        "listAssociations",
        "readAdoptionStatus",
      ].sort(),
    );
  });

  it("exports only what the provider documents", () => {
    expect(Object.keys(provider).sort()).toStrictEqual(
      ["handleCaseRequest", "localizeOpenApi", "parseCaseQuery", "queryEntities"].sort(),
    );
  });
});
