import { randomUUID } from "node:crypto";
import { readStatement } from "@interopkit/learning-records";
import { describe, expect, it } from "vitest";
import { providerStatement } from "../../../packages/learning-records/test/full-statement.ts";
import { ACCEPTANCES, ADVISORIES, type Json, REFUSALS, type XapiRule } from "../../../scripts/xapi-rules.ts";

const LRS = process.env.SQLLRS_URL;
const AUTHORIZATION = `Basic ${btoa(`${process.env.SQLLRS_USER}:${process.env.SQLLRS_PASSWORD}`)}`;

/** The Statement of a provider as JSON, which the fixtures of the rules change. */
function base(): Json {
  // The signature of the full Statement names data that no request carries, and SQL LRS 0.9.11 answers 500 to its contextGroups.
  const { attachments: _attachments, context, ...statement } = providerStatement();
  const { contextGroups: _groups, ...kept } = context ?? {};
  return JSON.parse(JSON.stringify({ ...statement, context: kept }));
}

/** What an implementation does with a Statement: it takes it, it refuses it with 400, or it fails with another status. */
type Verdict = "accepts" | "refuses" | `fails with ${number}`;

/** Posts a Statement to SQL LRS under an id of its own, unless the fixture is about the id, and says what it did. */
async function sqlLrsSays(statement: Json): Promise<Verdict> {
  const body = JSON.stringify(statement.id === base().id ? { ...statement, id: randomUUID() } : statement);
  const response = await fetch(`${LRS}/xapi/statements`, {
    method: "POST",
    headers: { "x-experience-api-version": "2.0.0", "content-type": "application/json", authorization: AUTHORIZATION },
    body,
  });
  await response.text();
  if (response.status === 200) return "accepts";
  return response.status === 400 ? "refuses" : `fails with ${response.status}`;
}

/** What the reader of an LRS says of a Statement. */
function readerSays(statement: Json): Verdict {
  try {
    readStatement(statement);
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
