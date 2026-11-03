import { describe, expect, it } from "vitest";
import { ACCEPTANCES, REFUSALS, type Session, SOUND } from "../../../scripts/cmi5-rules.js";
import { readLaunchData } from "../src/index.js";
import { sessionOrder } from "../src/rules/internal.js";
import { AU1, testHost } from "./lms-host.js";

const TOKEN_SECRET = "token-secret-of-the-rules";

/** The SHA-256 of a secret in base64url, as the LMS keeps it. */
async function hash(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/**
 * Sends the statements of a session of the rules table to the LMS, one request each, in the order of their timestamps, as
 * the unit of an active session whose launch data and registration are the facts of the table; returns the indexes that the
 * LMS refused.
 */
async function refusedByLms(session: Session): Promise<readonly number[]> {
  const host = testHost();
  const facts = session.facts as {
    readonly actor: { readonly account: { readonly homePage: string; readonly name: string } };
    readonly registration: string;
    readonly activityId: string;
    readonly launchData: unknown;
    readonly prior?: { readonly completed?: boolean; readonly passed?: boolean };
    readonly preferencesRead?: boolean;
  };
  const id = "5e55e55e-0000-4000-8000-000000000001";
  host.store.registrations.set(facts.registration, {
    id: facts.registration,
    course: "geology",
    actor: facts.actor,
    revision: 1,
    aus: Object.fromEntries(
      host.course.aus.map(({ publisherId, moveOn }) => [
        publisherId,
        {
          moveOn,
          satisfied: false,
          ...(publisherId === AU1 && facts.prior?.completed === true
            ? { completed: { statement: "prior-c", stored: true } }
            : {}),
          ...(publisherId === AU1 && facts.prior?.passed === true
            ? { passed: { statement: "prior-p", stored: true } }
            : {}),
        },
      ]),
    ),
    satisfiedBlocks: [],
    satisfied: false,
  });
  host.store.sessions.set(id, {
    id,
    registration: facts.registration,
    au: AU1,
    activityId: facts.activityId,
    actor: facts.actor,
    revision: 1,
    state: "active",
    launchData: readLaunchData(facts.launchData),
    fetchCode: "",
    token: await hash(TOKEN_SECRET),
    launchedAt: Date.parse("2026-01-15T09:59:00.000Z"),
    fetchedAt: Date.parse("2026-01-15T09:59:00.000Z"),
    reserved: [],
    preferencesRead: facts.preferencesRead ?? true,
  });
  const authorization = `Basic ${btoa(`${id}:${TOKEN_SECRET}`)}`;
  const statements = session.statements as readonly { readonly id?: string }[];
  const refused: number[] = [];
  for (const index of sessionOrder(session.statements as unknown as Parameters<typeof sessionOrder>[0])) {
    const statement = statements[index];
    const path = statement?.id === undefined ? "statements" : `statements?statementId=${statement.id}`;
    const answer = await host.xapi(statement?.id === undefined ? "POST" : "PUT", path, {
      authorization,
      body: statement,
    });
    expect([200, 204, 400, 403], `${index}: ${String(answer.body)}`).toContain(answer.status);
    if (answer.status >= 400) refused.push(index);
  }
  return refused.sort((left, right) => left - right);
}

describe("the rules of a session against the LMS", () => {
  it.each(REFUSALS)("refuses what $source asks ($text)", async (rule) => {
    const expected =
      rule.lms ??
      [
        ...new Set(
          rule.session
            .filter(({ severity }) => severity === "error")
            .map(({ path }) => Number(/^\[(\d+)\]/u.exec(path)?.[1])),
        ),
      ].sort((a, b) => a - b);
    expect(await refusedByLms(rule.fixture(SOUND))).toStrictEqual(expected);
  });

  it.each(ACCEPTANCES)("takes a session that keeps every rule: $text", async ({ fixture }) => {
    expect(await refusedByLms(fixture(SOUND))).toStrictEqual([]);
  });
});
