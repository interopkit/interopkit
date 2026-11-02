import { describe, expect, it } from "vitest";
import type { Actor, Statement, StatementQuery } from "../src/index.js";
import { matchesStatementQuery, readBasicAuthorization } from "../src/store/index.js";
import { uuid } from "./full-statement.js";

const LEARNER = { mbox: "mailto:learner@example.org" } as const;
const TEACHER = { mbox: "mailto:teacher@example.org" } as const;
const ACTIVITY = "https://example.org/activities/course-1";
const COMPLETED = "http://adlnet.gov/expapi/verbs/completed";

/** A stored Statement with the changes a test makes. */
function statement(n: number, changes: Partial<Statement> = {}): Statement {
  return {
    id: uuid(n),
    actor: LEARNER,
    verb: { id: COMPLETED },
    object: { objectType: "Activity", id: ACTIVITY },
    stored: "2026-01-15T10:30:00.000Z",
    ...changes,
  };
}

/** Tells whether a Statement matches a query, with the other Statements as targets. */
function matches(subject: Statement, query: StatementQuery, others: readonly Statement[] = []): boolean {
  const byId = new Map(others.map((other) => [other.id ?? "", other]));
  return matchesStatementQuery(subject, query, (id) => byId.get(id));
}

const ref = (target: number): Statement["object"] => ({ objectType: "StatementRef", id: uuid(target) });

describe("matchesStatementQuery: no filter", () => {
  it("matches every Statement for a query with no filter, and ignores limit, format, attachments and ascending", () => {
    expect(matches(statement(1), {})).toBe(true);
    expect(matches(statement(1), { limit: 1, format: "ids", attachments: true, ascending: true })).toBe(true);
  });
});

describe("matchesStatementQuery: agent", () => {
  it("matches the Actor and the Object that is an Agent or a Group, and nobody else", () => {
    const query = { agent: LEARNER };
    expect(matches(statement(1), query)).toBe(true);
    expect(matches(statement(1, { actor: TEACHER }), query)).toBe(false);
    expect(matches(statement(1, { actor: TEACHER, object: { objectType: "Agent", ...LEARNER } }), query)).toBe(true);
    expect(matches(statement(1, { actor: TEACHER, object: { objectType: "Group", ...LEARNER } }), query)).toBe(true);
    expect(matches(statement(1, { actor: TEACHER, object: { objectType: "Agent", ...TEACHER } }), query)).toBe(false);
  });

  it("matches by the identifier whichever it is, and folds the case of the parts that ignore case", () => {
    const cases: [Actor, Actor, boolean][] = [
      [{ mbox: "mailto:Learner@Example.ORG" }, LEARNER, true],
      [
        { mbox_sha1sum: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" },
        { mbox_sha1sum: "abcdef0123456789abcdef0123456789abcdef01" },
        true,
      ],
      [{ openid: "HTTPS://Example.ORG/openid/a" }, { openid: "https://example.org/openid/a" }, true],
      [{ openid: "https://example.org/openid/A" }, { openid: "https://example.org/openid/a" }, false],
      [
        { account: { homePage: "HTTPS://LMS.example.org", name: "u1" } },
        { account: { homePage: "https://lms.example.org", name: "u1" } },
        true,
      ],
      [
        { account: { homePage: "https://lms.example.org", name: "U1" } },
        { account: { homePage: "https://lms.example.org", name: "u1" } },
        false,
      ],
      [{ mbox: "mailto:a@example.org" }, { openid: "mailto:a@example.org" }, false],
    ];
    for (const [actor, asked, expected] of cases) {
      expect(matches(statement(1, { actor }), { agent: asked })).toBe(expected);
    }
  });

  it("matches a Group that has the Agent as a member, anonymous or identified, and an identified Group by its identifier", () => {
    const team: Actor = { objectType: "Group", member: [TEACHER, LEARNER] };
    expect(matches(statement(1, { actor: team }), { agent: LEARNER })).toBe(true);
    expect(matches(statement(1, { actor: team }), { agent: { mbox: "mailto:other@example.org" } })).toBe(false);
    const named: Actor = { objectType: "Group", mbox: "mailto:class@example.org", member: [LEARNER] };
    expect(matches(statement(1, { actor: named }), { agent: LEARNER })).toBe(true);
    expect(
      matches(statement(1, { actor: named }), { agent: { objectType: "Group", mbox: "mailto:class@example.org" } }),
    ).toBe(true);
    expect(
      matches(statement(1, { actor: LEARNER }), { agent: { objectType: "Group", mbox: "mailto:class@example.org" } }),
    ).toBe(false);
  });

  it("matches nothing for a Group with no identifier, since it names nobody", () => {
    expect(matches(statement(1), { agent: { objectType: "Group", member: [LEARNER] } })).toBe(false);
  });

  it("looks at the authority, the context and a SubStatement only when related_agents asks", () => {
    const sub: Statement["object"] = {
      objectType: "SubStatement",
      actor: TEACHER,
      verb: { id: COMPLETED },
      object: { objectType: "Agent", mbox: "mailto:third@example.org" },
      context: { instructor: { mbox: "mailto:fourth@example.org" } },
    };
    const wide = (changes: Partial<Statement>) =>
      statement(1, { actor: { mbox: "mailto:other@example.org" }, ...changes });
    const places: [Partial<Statement>, Actor][] = [
      [{ authority: TEACHER }, TEACHER],
      [{ context: { instructor: TEACHER } }, TEACHER],
      [
        { context: { team: { objectType: "Group", mbox: "mailto:team@example.org" } } },
        { mbox: "mailto:team@example.org" },
      ],
      [{ context: { team: { objectType: "Group", member: [TEACHER] } } }, TEACHER],
      [{ context: { contextAgents: [{ objectType: "contextAgent", agent: TEACHER }] } }, TEACHER],
      [
        {
          context: {
            contextGroups: [
              { objectType: "contextGroup", group: { objectType: "Group", mbox: "mailto:cg@example.org" } },
            ],
          },
        },
        { mbox: "mailto:cg@example.org" },
      ],
      [{ object: sub }, TEACHER],
      [{ object: sub }, { mbox: "mailto:third@example.org" }],
      [{ object: sub }, { mbox: "mailto:fourth@example.org" }],
    ];
    for (const [changes, asked] of places) {
      expect(matches(wide(changes), { agent: asked }), JSON.stringify(changes)).toBe(false);
      expect(matches(wide(changes), { agent: asked, relatedAgents: false }), JSON.stringify(changes)).toBe(false);
      expect(matches(wide(changes), { agent: asked, relatedAgents: true }), JSON.stringify(changes)).toBe(true);
    }
    expect(matches(wide({}), { agent: TEACHER, relatedAgents: true })).toBe(false);
  });
});

describe("matchesStatementQuery: verb, activity and registration", () => {
  it("matches the id of the Verb, with the scheme and the host folded", () => {
    expect(matches(statement(1), { verb: COMPLETED })).toBe(true);
    expect(matches(statement(1), { verb: "HTTP://ADLNET.gov/expapi/verbs/completed" })).toBe(true);
    expect(matches(statement(1), { verb: "http://adlnet.gov/expapi/verbs/Completed" })).toBe(false);
    expect(matches(statement(1), { verb: "http://adlnet.gov/expapi/verbs/failed" })).toBe(false);
  });

  it("matches an Object that is the Activity, and not one of another kind or in the context, unless related_activities asks", () => {
    expect(matches(statement(1), { activity: ACTIVITY })).toBe(true);
    expect(matches(statement(1, { object: { id: ACTIVITY } }), { activity: ACTIVITY })).toBe(true);
    expect(matches(statement(1, { object: { objectType: "Agent", ...TEACHER } }), { activity: ACTIVITY })).toBe(false);
    expect(matches(statement(1), { activity: "https://example.org/activities/other" })).toBe(false);
    const inContext = statement(1, {
      object: { id: "https://example.org/activities/other" },
      context: { contextActivities: { grouping: [{ id: ACTIVITY }] } },
    });
    expect(matches(inContext, { activity: ACTIVITY })).toBe(false);
    expect(matches(inContext, { activity: ACTIVITY, relatedActivities: false })).toBe(false);
    expect(matches(inContext, { activity: ACTIVITY, relatedActivities: true })).toBe(true);
  });

  it("looks in all four lists of the context and in a SubStatement for related_activities", () => {
    const base = { object: { id: "https://example.org/activities/other" } };
    for (const type of ["parent", "grouping", "category", "other"] as const) {
      const one = statement(1, { ...base, context: { contextActivities: { [type]: [{ id: ACTIVITY }] } } });
      expect(matches(one, { activity: ACTIVITY, relatedActivities: true })).toBe(true);
    }
    const sub = (inner: Partial<Extract<Statement["object"], { objectType: "SubStatement" }>>) =>
      statement(1, {
        object: {
          objectType: "SubStatement",
          actor: TEACHER,
          verb: { id: COMPLETED },
          object: { id: "https://example.org/activities/x" },
          ...inner,
        },
      });
    expect(matches(sub({ object: { id: ACTIVITY } }), { activity: ACTIVITY, relatedActivities: true })).toBe(true);
    expect(matches(sub({ object: { id: ACTIVITY } }), { activity: ACTIVITY })).toBe(false);
    expect(
      matches(sub({ context: { contextActivities: { parent: [{ id: ACTIVITY }] } } }), {
        activity: ACTIVITY,
        relatedActivities: true,
      }),
    ).toBe(true);
    expect(
      matches(sub({ object: { objectType: "Agent", ...TEACHER } }), { activity: ACTIVITY, relatedActivities: true }),
    ).toBe(false);
  });

  it("matches the registration of the context in any case", () => {
    const registered = statement(1, { context: { registration: uuid(7).toUpperCase() } });
    expect(matches(registered, { registration: uuid(7) })).toBe(true);
    expect(matches(registered, { registration: uuid(8) })).toBe(false);
    expect(matches(statement(1), { registration: uuid(7) })).toBe(false);
  });

  it("needs every filter to be met", () => {
    expect(matches(statement(1), { agent: LEARNER, verb: COMPLETED, activity: ACTIVITY })).toBe(true);
    expect(
      matches(statement(1), { agent: LEARNER, verb: "http://adlnet.gov/expapi/verbs/failed", activity: ACTIVITY }),
    ).toBe(false);
  });
});

describe("matchesStatementQuery: time", () => {
  it("takes since as exclusive and until as inclusive, in any offset", () => {
    const at = statement(1, { stored: "2026-01-15T10:30:00.000Z" });
    expect(matches(at, { since: "2026-01-15T10:29:59.999Z" })).toBe(true);
    expect(matches(at, { since: "2026-01-15T10:30:00.000Z" })).toBe(false);
    expect(matches(at, { until: "2026-01-15T10:30:00.000Z" })).toBe(true);
    expect(matches(at, { until: "2026-01-15T10:29:59.999Z" })).toBe(false);
    expect(matches(at, { since: "2026-01-15T11:29:59+01:00", until: "2026-01-15T11:30:00+01:00" })).toBe(true);
  });

  it("matches no Statement that has no stored time against a filter on time, and every one against none", () => {
    const { stored: _stored, ...notStored } = statement(1);
    expect(matches(notStored, { since: "2000-01-01T00:00:00Z" })).toBe(false);
    expect(matches(notStored, { until: "2100-01-01T00:00:00Z" })).toBe(false);
    expect(matches(notStored, { verb: COMPLETED })).toBe(true);
  });
});

describe("matchesStatementQuery: Statement References", () => {
  const confirm = (n: number, target: number, changes: Partial<Statement> = {}): Statement =>
    statement(n, {
      actor: TEACHER,
      verb: { id: "http://adlnet.gov/expapi/verbs/confirmed" },
      object: ref(target),
      ...changes,
    });

  it("matches a Statement that refers to one that meets the filter, which the example of the standard needs", () => {
    const passed = statement(1, { verb: { id: "http://adlnet.gov/expapi/verbs/passed" } });
    const confirmed = confirm(2, 1);
    expect(matches(confirmed, { agent: LEARNER }, [passed])).toBe(true);
    expect(matches(confirmed, { verb: "http://adlnet.gov/expapi/verbs/passed" }, [passed])).toBe(true);
    expect(matches(confirmed, { activity: ACTIVITY }, [passed])).toBe(true);
    expect(matches(confirmed, { verb: "http://adlnet.gov/expapi/verbs/failed" }, [passed])).toBe(false);
  });

  it("follows the references to any depth, and ends a chain that comes back to itself", () => {
    const base = statement(1);
    const chain = [confirm(2, 1), confirm(3, 2), confirm(4, 3)];
    expect(matches(chain[2] as Statement, { agent: LEARNER }, [base, ...chain])).toBe(true);
    const loop = [confirm(5, 6), confirm(6, 5)];
    expect(matches(loop[0] as Statement, { agent: LEARNER }, loop)).toBe(false);
    expect(matches(confirm(7, 7), { agent: LEARNER }, [])).toBe(false);
  });

  it("judges each filter by itself, so one may be met by the Statement and another by the one it refers to", () => {
    const passed = statement(1);
    const confirmed = confirm(2, 1);
    expect(matches(confirmed, { agent: LEARNER, verb: "http://adlnet.gov/expapi/verbs/confirmed" }, [passed])).toBe(
      true,
    );
    expect(matches(confirmed, { agent: LEARNER, verb: "http://adlnet.gov/expapi/verbs/failed" }, [passed])).toBe(false);
  });

  it("finds the target by its id in lower case, a voided one too, and matches nothing for one it cannot find", () => {
    const upper = confirm(2, 1, { object: { objectType: "StatementRef", id: uuid(1).toUpperCase() } });
    expect(matches(upper, { agent: LEARNER }, [statement(1)])).toBe(true);
    expect(matches(upper, { agent: LEARNER }, [])).toBe(false);
  });

  it("applies since and until to the Statement that refers, and never to the one it refers to", () => {
    const old = statement(1, { stored: "2020-01-01T00:00:00.000Z" });
    const later = confirm(2, 1, { stored: "2026-01-15T10:30:00.000Z" });
    expect(matches(later, { agent: LEARNER, since: "2025-01-01T00:00:00Z" }, [old])).toBe(true);
    expect(matches(later, { agent: LEARNER, until: "2025-01-01T00:00:00Z" }, [old])).toBe(false);
  });

  it("does not take a Statement Reference in the context as a reference", () => {
    const named = statement(2, { actor: TEACHER, context: { statement: { objectType: "StatementRef", id: uuid(1) } } });
    expect(matches(named, { agent: LEARNER }, [statement(1)])).toBe(false);
  });
});

describe("matchesStatementQuery: a long chain of references", () => {
  it("walks a chain longer than the stack could hold", () => {
    const length = 200_000;
    const held = new Map<string, Statement>();
    for (let n = 0; n < length; n += 1) {
      held.set(uuid(n), statement(n, { object: { objectType: "StatementRef", id: uuid(n + 1) } }));
    }
    held.set(uuid(length), statement(length, { verb: { id: "https://example.org/verbs/last" } }));
    const first = held.get(uuid(0)) as Statement;
    expect(matchesStatementQuery(first, { verb: "https://example.org/verbs/last" }, (id) => held.get(id))).toBe(true);
    expect(matchesStatementQuery(first, { verb: "https://example.org/verbs/none" }, (id) => held.get(id))).toBe(false);
  });
});

describe("readBasicAuthorization", () => {
  const headerOf = (credentials: string) => ({ headers: { authorization: `Basic ${btoa(credentials)}` } });

  it("reads the user and the password", () => {
    expect(readBasicAuthorization(headerOf("user:secret"))).toStrictEqual({ user: "user", password: "secret" });
  });

  it("ends the user at the first colon, so the password may hold colons, and may be empty", () => {
    expect(readBasicAuthorization(headerOf("user:a:b:c"))).toStrictEqual({ user: "user", password: "a:b:c" });
    expect(readBasicAuthorization(headerOf("user:"))).toStrictEqual({ user: "user", password: "" });
    expect(readBasicAuthorization(headerOf(":secret"))).toStrictEqual({ user: "", password: "secret" });
  });

  it("reads the scheme in any case and UTF-8 credentials", () => {
    const utf8 = btoa(String.fromCharCode(...new TextEncoder().encode("naïve:pässwörd")));
    expect(readBasicAuthorization({ headers: { authorization: `bAsIc ${utf8}` } })).toStrictEqual({
      user: "naïve",
      password: "pässwörd",
    });
  });

  it("gives nothing for no header, another scheme, a value that is not base64 or not UTF-8, or no colon", () => {
    expect(readBasicAuthorization({ headers: {} })).toBeUndefined();
    expect(readBasicAuthorization({ headers: { authorization: "Bearer abc" } })).toBeUndefined();
    expect(readBasicAuthorization({ headers: { authorization: "Basic" } })).toBeUndefined();
    expect(readBasicAuthorization({ headers: { authorization: "Basic !!!" } })).toBeUndefined();
    expect(readBasicAuthorization({ headers: { authorization: `Basic ${btoa("\xff\xfe:x")}` } })).toBeUndefined();
    expect(readBasicAuthorization(headerOf("no colon here"))).toBeUndefined();
    expect(readBasicAuthorization({ headers: { authorization: "Basic a b" } })).toBeUndefined();
  });
});
