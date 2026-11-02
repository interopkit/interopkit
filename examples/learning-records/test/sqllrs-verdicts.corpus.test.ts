import { randomUUID } from "node:crypto";
import { readStatement, type XapiVersion } from "@interopkit/learning-records";
import { describe, expect, it } from "vitest";
import { providerStatement, providerStatementV1 } from "../../../packages/learning-records/test/full-statement.ts";
import { ACCEPTANCES, ADVISORIES, type Json, REFUSALS, type XapiRule } from "../../../scripts/xapi-rules.ts";
import { ACCEPTANCES_V1, ADVISORIES_V1, REFUSALS_V1 } from "../../../scripts/xapi-v1-rules.ts";

const LRS = process.env.SQLLRS_URL;
const AUTHORIZATION = `Basic ${btoa(`${process.env.SQLLRS_USER}:${process.env.SQLLRS_PASSWORD}`)}`;

/** The Statement of a provider as JSON, which the fixtures of the rules change. */
function base(): Json {
  // The signature of the full Statement names data that no request carries, and SQL LRS 0.9.11 answers 500 to its contextGroups.
  const { attachments: _attachments, context, ...statement } = providerStatement();
  const { contextGroups: _groups, ...kept } = context ?? {};
  return JSON.parse(JSON.stringify({ ...statement, context: kept }));
}

/** The Statement of a provider of 1.0.3 as JSON: no Attachment, for the reason above. */
function baseV1(): Json {
  const { attachments: _attachments, ...statement } = providerStatementV1();
  return JSON.parse(JSON.stringify(statement));
}

/** What an implementation does with a Statement: it takes it, it refuses it with 400, or it fails with another status. */
type Verdict = "accepts" | "refuses" | `fails with ${number}`;

/** Posts a Statement to a route of SQL LRS under an id of its own, unless the fixture is about the id, and says what it did. */
async function sqlLrsSays(statement: Json, version: XapiVersion = "2.0.0"): Promise<Verdict> {
  const body = JSON.stringify(statement.id === base().id ? { ...statement, id: randomUUID() } : statement);
  const response = await fetch(`${LRS}/xapi/statements`, {
    method: "POST",
    headers: { "x-experience-api-version": version, "content-type": "application/json", authorization: AUTHORIZATION },
    body,
  });
  await response.text();
  if (response.status === 200) return "accepts";
  return response.status === 400 ? "refuses" : `fails with ${response.status}`;
}

/** What the reader of an LRS of a version says of a Statement. */
function readerSays(statement: Json, version: XapiVersion = "2.0.0"): Verdict {
  try {
    readStatement(statement, { version });
    return "accepts";
  } catch {
    return "refuses";
  }
}

/** A place where the two differ: what each says. */
interface Difference {
  readonly ours: Verdict;
  readonly theirs: Verdict;
}

/**
 * Where SQL LRS 0.9.11 and the reader of an LRS differ on the fixtures of the rules, and why. Each is recorded in
 * `docs/learning-records/spec-gaps.md` with the text of the standard. The test fails when another difference appears and when
 * one of these goes, so that the list is the whole of it.
 */
const DIFFERENCES: Readonly<Record<string, Difference>> = {
  "LRS 4.2.2.4: The lowest possible score is less than max.": { ours: "refuses", theirs: "accepts" },
  "LRS 4.2.4.2 and Content 5.2.1: An LRS may return 400 if the remaining properties are not valid for the Interaction Activity. An LRP shall not add additional properties.":
    { ours: "accepts", theirs: "refuses" },
  "LRS 4.2.4.2 and Content 5.2.1: No component lists are supported for fill-in.": {
    ours: "accepts",
    theirs: "refuses",
  },
  "LRS 4.2.2.3: The id identifies the interaction component within the list.": { ours: "accepts", theirs: "refuses" },
  "LRS 4.2.7: Metadata and names may be written in any language and any script.": {
    ours: "accepts",
    theirs: "refuses",
  },
  "LRS 4.2.2.5: The authority is an Agent, or an anonymous Group of two Agents.": {
    ours: "accepts",
    theirs: "refuses",
  },
};

describe("SQL LRS as the oracle of the rules", () => {
  const tables: readonly (readonly [string, readonly Pick<XapiRule, "source" | "text" | "fixture">[]])[] = [
    ["a Statement that breaks a rule", REFUSALS],
    ["a Statement with a warning, or that the roles judge alike", ADVISORIES],
    ["a Statement that an LRS shall not reject", ACCEPTANCES],
  ];

  it("has the verdicts of the reader of an LRS on every fixture, except where SQL LRS answers otherwise", async () => {
    expect(LRS, "pnpm sql-lrs sets SQLLRS_URL").toBeDefined();
    const found: Record<string, Difference> = {};
    let total = 0;
    for (const [, rules] of tables) {
      for (const rule of rules) {
        total += 1;
        const statement = rule.fixture(base());
        const [theirs, ours] = [await sqlLrsSays(statement), readerSays(statement)];
        if (theirs !== ours) found[`${rule.source}: ${rule.text}`] = { ours, theirs };
      }
    }
    expect(total).toBe(REFUSALS.length + ADVISORIES.length + ACCEPTANCES.length);
    expect(found).toStrictEqual(DIFFERENCES);
  });

  it("refuses every Statement that breaks a rule of an LRS, with 400 and not with a failure, except where SQL LRS accepts it", async () => {
    const refused = await Promise.all(
      REFUSALS.map(async (rule) => [rule, await sqlLrsSays(rule.fixture(base()))] as const),
    );
    const wrong = refused.filter(
      ([rule, verdict]) => verdict !== "refuses" && !(`${rule.source}: ${rule.text}` in DIFFERENCES),
    );
    expect(wrong.map(([rule, verdict]) => `${rule.source}: ${rule.text} -> ${verdict}`)).toStrictEqual([]);
  });
});

/**
 * Where SQL LRS 0.9.11 on its 1.0.3 route and the reader of an LRS of 1.0.3 differ on the fixtures of the rules, and why. Each is
 * recorded in `docs/learning-records/spec-gaps.md` with the text of the standard.
 */
const DIFFERENCES_V1: Readonly<Record<string, Difference>> = {
  "Data 2.4.4.1 and Data 2.2: An LRS may return 400 if the remaining properties are not valid for the Interaction Activity. Additional properties should not be added.":
    { ours: "accepts", theirs: "refuses" },
  "Data 2.4.4.1 and Data 2.2: No component lists are supported for fill-in.": { ours: "accepts", theirs: "refuses" },
  "Data 2.4.4.1: Within an array of interaction components, all id values must be distinct. An LRS may validate the properties of an interaction.":
    { ours: "accepts", theirs: "refuses" },
  "Data 2.4.5.1: The lowest possible score is less than max.": { ours: "refuses", theirs: "accepts" },
  "Data 2.4.9: In 3-legged OAuth the authority is a Group with two Agents.": { ours: "accepts", theirs: "refuses" },
  "Data 4.2: A language map may be populated with any language and any script.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: A SubStatement is held to the same form.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: A Timestamp in the basic format of ISO 8601 with an offset.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: A Timestamp in the basic format of ISO 8601.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: A Timestamp should be expressed in the format of RFC 3339, which the provider rules hold as a requirement: the basic format.":
    { ours: "accepts", theirs: "refuses" },
  "Data 4.5: An offset of ISO 8601 in hours: +02.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: ISO 8601 may leave out the minutes.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: ISO 8601 may leave out the seconds.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: RFC 3339 writes the minutes of an offset.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: RFC 3339 writes the seconds of a time.": { ours: "accepts", theirs: "refuses" },
  "Data 4.5: The provider rules hold stored to the same form.": { ours: "accepts", theirs: "refuses" },
};

describe("SQL LRS as the oracle of the rules of 1.0.3", () => {
  it("has the verdicts of the reader of an LRS of 1.0.3 on every fixture, except where SQL LRS answers otherwise", async () => {
    expect(LRS, "pnpm sql-lrs sets SQLLRS_URL").toBeDefined();
    const found: Record<string, Difference> = {};
    for (const rule of [...REFUSALS_V1, ...ADVISORIES_V1, ...ACCEPTANCES_V1]) {
      const statement = rule.fixture(baseV1());
      const [theirs, ours] = [await sqlLrsSays(statement, "1.0.3"), readerSays(statement, "1.0.3")];
      if (theirs !== ours) found[`${rule.source}: ${rule.text}`] = { ours, theirs };
    }
    expect(found).toStrictEqual(DIFFERENCES_V1);
  });
});
