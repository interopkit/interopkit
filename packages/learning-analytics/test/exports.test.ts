import { describe, expect, it } from "vitest";
import * as endpoint from "../src/endpoint/index.js";
import * as root from "../src/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "ACCESS_FORMS",
        "ACTIONS",
        "AGENT_TYPES",
        "ANNOTATION_TYPES",
        "ASSIGNABLE_TYPES",
        "buildEntity",
        "buildEvent",
        "CALIPER_1_1_CONTEXT",
        "CALIPER_CONTEXT",
        "CALIPER_VERSIONS",
        "checkIri",
        "COURSE_OFFERING_TYPES",
        "DEFAULT_CALIPER_TIMEOUT_MS",
        "DIGITAL_RESOURCE_TYPES",
        "ENTITY_TYPES",
        "EVENT_TYPES",
        "LIBRARY_PROFILE_CONTEXT",
        "LTI_MESSAGE_TYPES",
        "METRICS",
        "MEDIA_OBJECT_TYPES",
        "mintUrn",
        "pingEndpoint",
        "ORGANIZATION_TYPES",
        "PROFILES",
        "QUESTION_TYPES",
        "readEntity",
        "readEvent",
        "RESPONSE_TYPES",
        "ROLES",
        "SCALE_TYPES",
        "sendCaliper",
        "SESSION_TYPES",
        "STATUSES",
        "SYNCHRONICITIES",
        "SYSTEM_IDENTIFIER_TYPES",
        "validateEntity",
        "validateEvent",
      ].sort(),
    );
  });

  it("exports the endpoint from its own subpath, and keeps it out of the root", () => {
    expect(Object.keys(endpoint).sort()).toStrictEqual(["handleCaliperRequest", "readEnvelope"]);
    expect(Object.keys(root)).not.toContain("handleCaliperRequest");
  });
});
