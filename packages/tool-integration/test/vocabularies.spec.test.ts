import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLtiTables } from "../../../scripts/lti-tables.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import {
  CONTEXT_ROLES,
  CONTEXT_SUB_ROLES,
  CONTEXT_TYPES,
  canonicalizeContextType,
  canonicalizeRole,
  INSTITUTION_ROLES,
  LTI_SYSTEM_ROLES,
  SYSTEM_ROLES,
} from "../src/index.js";
import { baseMessage, launch, setup } from "./platform-setup.js";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The tables are those of Appendices A and B of LTI Core as the open portal prints them: `pnpm schemas` downloads the page at
 * the hash that scripts/schemas.lock.json pins.
 */
const root = resolve(import.meta.dirname, "../../..");
const tables = parseLtiTables(readFileSync(join(requireSchemas(root), "lti-core-portal.html"), "utf8"));

describe("the vocabularies against Appendix A of LTI Core", () => {
  it("hold the roles of the appendix, in its order", () => {
    expect(SYSTEM_ROLES).toEqual(tables.systemRoles);
    expect(INSTITUTION_ROLES).toEqual(tables.institutionRoles);
    expect(CONTEXT_ROLES).toEqual(tables.contextRoles);
    expect(LTI_SYSTEM_ROLES).toEqual(tables.ltiRoles);
  });

  it("hold the sub-roles of each principal role of the appendix", () => {
    const prefix = "http://purl.imsglobal.org/vocab/lis/v2/membership";
    const expected = Object.entries(tables.contextSubRoles).flatMap(([role, names]) =>
      names.map((name) => `${prefix}/${role}#${name}`),
    );
    expect(CONTEXT_SUB_ROLES).toEqual(expected);
    expect(Object.keys(tables.contextSubRoles).sort()).toEqual(
      CONTEXT_ROLES.map((uri) => uri.slice(uri.indexOf("#") + 1)).sort(),
    );
  });

  it("hold the context types of the appendix, and every deprecated name beside a type canonicalizes to it", () => {
    expect(CONTEXT_TYPES).toEqual(tables.contextTypes.map(({ uri }) => uri));
    for (const { uri, deprecated } of tables.contextTypes) {
      expect(deprecated).toHaveLength(2);
      for (const name of deprecated) expect(canonicalizeContextType(name), name).toBe(uri);
    }
  });

  it("canonicalize the simple name of every context role that the appendix lists", () => {
    for (const uri of tables.contextRoles) expect(canonicalizeRole(uri.slice(uri.indexOf("#") + 1)), uri).toBe(uri);
  });
});

describe("the variables of Appendix B of LTI Core", () => {
  it("are 126 names, 6 of them only on the portal: Organization.* and ResourceLink.relaunchURL", () => {
    expect(tables.variables).toHaveLength(126);
    for (const name of [
      "Organization.id",
      "Organization.type",
      "Organization.name",
      "Organization.description",
      "Organization.url",
      "ResourceLink.relaunchURL",
    ]) {
      expect(tables.variables, name).toContain(name);
    }
    expect(tables.variables).toContain("User.gradeLevels.*");
    expect(tables.variables).toContain("ToolPlatformInstance.contactEmail");
    expect(new Set(tables.variables).size).toBe(tables.variables.length);
  });
});

describe("the variables of Appendix B in the platform role", () => {
  /** The variables that the message answers, as the design of the platform role lists them. */
  const Answered = [
    "User.id",
    "User.image",
    "User.scope.mentor",
    "Person.sourcedId",
    "Person.name.full",
    "Person.name.family",
    "Person.name.given",
    "Person.name.middle",
    "Person.email.primary",
    "Context.id",
    "Context.type",
    "Context.label",
    "Context.title",
    "CourseOffering.sourcedId",
    "CourseSection.sourcedId",
    "ResourceLink.id",
    "ResourceLink.title",
    "ResourceLink.description",
    "Message.returnUrl",
    "Message.documentTarget",
    "Message.height",
    "Message.width",
    "Message.locale",
    "Organization.id",
    "Organization.type",
    "Organization.name",
    "Organization.description",
    "Organization.url",
    "ToolPlatform.productFamilyCode",
    "ToolPlatform.version",
    "ToolPlatformInstance.guid",
    "ToolPlatformInstance.name",
    "ToolPlatformInstance.description",
    "ToolPlatformInstance.url",
    "ToolPlatformInstance.contactEmail",
  ];

  it("are each answered by the message, or resolved by the host's substitution", async () => {
    const ctx = setup();
    const asked: string[] = [];
    const substitution = {
      names: tables.variables,
      resolve: async (name: string) => {
        asked.push(name);
        return "host";
      },
    };
    const custom = Object.fromEntries(tables.variables.map((name, index) => [`v${index}`, `$${name}`]));
    const { claims } = await launch(ctx, { ...baseMessage, custom }, { substitution });
    const values = claims["https://purl.imsglobal.org/spec/lti/claim/custom"] as Record<string, string>;
    const fromMessage = tables.variables.filter((_, index) => values[`v${index}`] !== "host");
    expect(fromMessage).toEqual(tables.variables.filter((name) => Answered.includes(name)));
    expect(Answered.every((name) => tables.variables.includes(name))).toBe(true);
    expect(asked).toEqual(tables.variables.filter((name) => !Answered.includes(name)));
    expect(Object.values(values).some((value) => value.startsWith("$"))).toBe(false);
  });
});
