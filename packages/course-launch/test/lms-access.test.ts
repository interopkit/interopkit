import { describe, expect, it } from "vitest";
import { readLaunchUrl } from "../src/index.js";
import { extendLrsOptions, prepareLaunch } from "../src/lms/index.js";
import { AU1, LMS_CREDENTIAL, ORIGIN, testHost } from "./lms-host.js";
import { type Launched, launchUnit, register, sendStatement, unitStatement } from "./lms-session.js";

/** A host with a launched unit that read its launch data and initialized. */
async function started(changes: Parameters<typeof testHost>[0] = {}) {
  const host = testHost(changes);
  const registration = await register(host);
  const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
  await sendStatement(host, launched, unitStatement(launched, "initialized"));
  return { host, launched };
}

/** The query of a document of the learner of a launch. */
function documentQuery(launched: Launched, extra: Record<string, string>, agent: unknown = launched.actor): string {
  return new URLSearchParams({ agent: JSON.stringify(agent), ...extra }).toString();
}

const OTHER = { objectType: "Agent", account: { homePage: ORIGIN, name: "learner-2" } };
const PREFERENCES = { languagePreference: "en-US,fr-FR", audioPreference: "on" };

describe("the token of a session", () => {
  it("is refused with 401 when its secret is not the session's, or before the unit fetched it", async () => {
    const { host, launched } = await started();
    const forged = `Basic ${btoa(`${launched.launch.session}:not-the-secret`)}`;
    expect((await host.xapi("GET", "about", { authorization: forged })).status).toBe(401);
    const registration = await register(host);
    const launch = await prepareLaunch({ registration: registration.id, au: AU1 }, host.options);
    const early = `Basic ${btoa(`${launch.session}:${new URL(readLaunchUrl(launch.url).fetch).searchParams.get("code")}`)}`;
    const answer = await host.xapi("GET", `statements?registration=${registration.id}`, { authorization: early });
    expect(answer.status).toBe(401);
    expect(answer.headers["www-authenticate"]).toBeUndefined();
  });

  it("leaves a credential that is no token, or names no session, to the host's access", async () => {
    const { host } = await started();
    expect((await host.xapi("GET", "about")).status).toBe(401);
    expect((await host.xapi("GET", "about", { authorization: `Basic ${btoa("someone:secret")}` })).status).toBe(401);
    const unknown = `Basic ${btoa("11111111-1111-4111-8111-111111111111:secret")}`;
    expect((await host.xapi("GET", "about", { authorization: unknown })).status).toBe(401);
    expect((await host.xapi("GET", "about", { authorization: LMS_CREDENTIAL })).status).toBe(200);
  });
});

describe("what a unit may do with its token", () => {
  it("reads the statements of its registration and of its learner, and none by id or of another registration", async () => {
    const { host, launched } = await started();
    const { authorization, registration } = launched;
    const own = new URLSearchParams({ registration, agent: JSON.stringify(launched.actor) });
    expect((await host.xapi("GET", `statements?${own}`, { authorization })).status).toBe(200);
    const refused = [
      `statements?statementId=${launched.launch.session}&registration=${registration}`,
      `statements?voidedStatementId=${launched.launch.session}&registration=${registration}`,
      "statements",
      "statements?registration=9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d",
      `statements?${new URLSearchParams({ registration, agent: JSON.stringify(OTHER) })}`,
    ];
    for (const path of refused) expect((await host.xapi("GET", path, { authorization })).status, path).toBe(403);
  });

  it("never changes LMS.LaunchData nor removes every State document of an activity", async () => {
    const { host, launched } = await started();
    const { authorization } = launched;
    const launchData = documentQuery(launched, {
      activityId: launched.activityId,
      registration: launched.registration,
      stateId: "LMS.LaunchData",
    });
    for (const method of ["PUT", "POST", "DELETE"]) {
      const answer = await host.xapi(method, `activities/state?${launchData}`, {
        authorization,
        body: method === "DELETE" ? undefined : {},
      });
      expect(answer.status, method).toBe(403);
    }
    const every = documentQuery(launched, { activityId: launched.activityId, registration: launched.registration });
    expect((await host.xapi("DELETE", `activities/state?${every}`, { authorization })).status).toBe(403);
    expect((await host.xapi("GET", `activities/state?${launchData}`, { authorization })).status).toBe(200);
  });

  it("reads and writes the State of its learner in its registration only", async () => {
    const { host, launched } = await started();
    const { authorization } = launched;
    const own = documentQuery(launched, {
      activityId: launched.activityId,
      registration: launched.registration,
      stateId: "bookmark",
    });
    expect((await host.xapi("PUT", `activities/state?${own}`, { authorization, body: { page: 3 } })).status).toBe(204);
    expect((await host.xapi("GET", `activities/state?${own}`, { authorization })).status).toBe(200);
    expect((await host.xapi("DELETE", `activities/state?${own}`, { authorization })).status).toBe(204);
    const other = documentQuery(launched, { activityId: launched.activityId, stateId: "bookmark" }, OTHER);
    expect((await host.xapi("GET", `activities/state?${other}`, { authorization })).status).toBe(403);
    const elsewhere = documentQuery(launched, {
      activityId: launched.activityId,
      registration: "9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d",
      stateId: "bookmark",
    });
    expect((await host.xapi("GET", `activities/state?${elsewhere}`, { authorization })).status).toBe(403);
    // Without an agent, or with one that is no JSON object, the rules of xAPI answer 400.
    for (const agent of [undefined, "not json", "[1]"]) {
      const query = new URLSearchParams({
        activityId: launched.activityId,
        stateId: "bookmark",
        ...(agent === undefined ? {} : { agent }),
      });
      expect((await host.xapi("GET", `activities/state?${query}`, { authorization })).status, String(agent)).toBe(400);
    }
  });

  it("writes the preferences of its learner only as a valid document, and never removes them", async () => {
    const { host, launched } = await started();
    const { authorization } = launched;
    const path = `agents/profile?${documentQuery(launched, { profileId: "cmi5LearnerPreferences" })}`;
    const created = await host.xapi("PUT", path, {
      authorization,
      body: PREFERENCES,
      headers: { "if-none-match": "*" },
    });
    expect(created.status).toBe(204);
    const invalid: readonly { readonly body: unknown; readonly type?: string }[] = [
      { body: PREFERENCES, type: "text/plain" },
      { body: "just some text", type: "text/plain" },
      { body: { audioPreference: "on" } },
      { body: { languagePreference: "en-US" } },
      { body: { languagePreference: "not comma separated", audioPreference: "on" } },
      { body: { languagePreference: "", audioPreference: "on" } },
      { body: [] },
      { body: "{" },
      { body: { ...PREFERENCES, padding: "x".repeat(5000) } },
    ];
    for (const { body, type } of invalid) {
      const headers = { "content-type": type ?? "application/json" };
      expect(
        (await host.xapi("PUT", path, { authorization, body, headers })).status,
        JSON.stringify(body).slice(0, 60),
      ).toBe(403);
    }
    expect((await host.xapi("POST", path, { authorization, body: { audioPreference: "off" } })).status).toBe(403);
    expect((await host.xapi("DELETE", path, { authorization, body: PREFERENCES })).status).toBe(403);
    const other = `agents/profile?${documentQuery(launched, { profileId: "cmi5LearnerPreferences" }, OTHER)}`;
    expect((await host.xapi("PUT", other, { authorization, body: PREFERENCES })).status).toBe(403);
    const anonymous = `agents/profile?${new URLSearchParams({ profileId: "cmi5LearnerPreferences" })}`;
    expect((await host.xapi("PUT", anonymous, { authorization, body: PREFERENCES })).status).toBe(400);
  });

  it("only reads the preferences when the LMS keeps them read-only", async () => {
    const { host, launched } = await started({ learnerPreferences: "read-only" });
    const path = `agents/profile?${documentQuery(launched, { profileId: "cmi5LearnerPreferences" })}`;
    expect((await host.xapi("PUT", path, { authorization: launched.authorization, body: PREFERENCES })).status).toBe(
      403,
    );
    expect((await host.xapi("GET", path, { authorization: launched.authorization })).status).toBe(404);
  });

  it("reads and writes other profiles, the Agents of its learner, the Activities and About", async () => {
    const { host, launched } = await started();
    const { authorization } = launched;
    const profile = `agents/profile?${documentQuery(launched, { profileId: "notes" })}`;
    const created = await host.xapi("PUT", profile, {
      authorization,
      body: { a: 1 },
      headers: { "if-none-match": "*" },
    });
    expect(created.status).toBe(204);
    expect((await host.xapi("GET", profile, { authorization })).status).toBe(200);
    expect((await host.xapi("GET", `agents?${documentQuery(launched, {})}`, { authorization })).status).toBe(200);
    expect((await host.xapi("GET", `agents?${documentQuery(launched, {}, OTHER)}`, { authorization })).status).toBe(
      403,
    );
    const activityProfile = `activities/profile?${new URLSearchParams({ activityId: launched.activityId, profileId: "p" })}`;
    const written = await host.xapi("PUT", activityProfile, {
      authorization,
      body: { a: 1 },
      headers: { "if-none-match": "*" },
    });
    expect(written.status).toBe(204);
    expect((await host.xapi("GET", activityProfile, { authorization })).status).toBe(200);
    expect(
      (await host.xapi("GET", `activities?activityId=${encodeURIComponent(launched.activityId)}`, { authorization }))
        .status,
    ).toBe(200);
    expect((await host.xapi("GET", "about", { authorization })).status).toBe(200);
    expect((await host.xapi("GET", "nothing", { authorization })).status).toBe(404);
  });

  it("may not void, and has every statement judged by the rules of cmi5 with 403", async () => {
    const { host, launched } = await started();
    const allowed = unitStatement(launched, "experienced");
    expect((await sendStatement(host, launched, allowed)).status).toBe(204);
    const voiding = {
      ...unitStatement(launched, "experienced"),
      verb: { id: "http://adlnet.gov/expapi/verbs/voided" },
      object: { objectType: "StatementRef", id: allowed.id },
    };
    expect((await sendStatement(host, launched, voiding as typeof allowed)).status).toBe(403);
    const posted = await host.xapi("POST", "statements", {
      authorization: launched.authorization,
      body: [
        unitStatement(launched, "experienced"),
        { ...unitStatement(launched, "experienced"), timestamp: undefined },
      ],
    });
    expect(posted.status).toBe(403);
  });
});

describe("the requests of the host's credentials", () => {
  it("are judged by the host's accept, which keeps the status of 403", async () => {
    const host = testHost();
    const options = extendLrsOptions(
      {
        ...host.lrsOptions,
        accept: async () => [{ path: "", rule: "host", message: "is refused by the host.", severity: "error" }],
      },
      host.options,
    );
    const { handleLrsRequest } = await import("@interopkit/learning-records/store");
    const statement = {
      id: "0b5c6d7e-8f90-4a1b-8c2d-999999999999",
      actor: { mbox: "mailto:someone@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
      object: { id: "https://example.org/a" },
    };
    const answer = await handleLrsRequest(
      {
        method: "POST",
        url: `${ORIGIN}/xapi/statements`,
        headers: {
          authorization: LMS_CREDENTIAL,
          "x-experience-api-version": "1.0.3",
          "content-type": "application/json",
        },
        body: new TextEncoder().encode(JSON.stringify(statement)),
      },
      options,
    );
    expect(answer.status).toBe(403);
    expect((await host.xapi("POST", "statements", { authorization: LMS_CREDENTIAL, body: statement })).status).toBe(
      200,
    );
  });
});

describe("the LRS of the host for its own credentials", () => {
  it("answers every request of a credential of the host as the host's options alone answer it", async () => {
    const { handleLrsRequest } = await import("@interopkit/learning-records/store");
    const answers = async (extended: boolean) => {
      const host = testHost();
      const options = extended ? host.lrsOptions : host.lrsBase;
      const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
        handleLrsRequest(
          {
            method,
            url: `${ORIGIN}/xapi/${path}`,
            headers: {
              authorization: LMS_CREDENTIAL,
              "x-experience-api-version": "1.0.3",
              ...(body === undefined ? {} : { "content-type": "application/json" }),
              ...headers,
            },
            body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
          },
          options,
        );
      const statement = {
        id: "0b5c6d7e-8f90-4a1b-8c2d-cccccccccccc",
        actor: { mbox: "mailto:someone@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/voided" },
        object: { objectType: "StatementRef", id: "0b5c6d7e-8f90-4a1b-8c2d-dddddddddddd" },
        timestamp: "2026-01-15T10:00:00+07:00",
      };
      const agent = JSON.stringify({ mbox: "mailto:someone@example.org" });
      const state = new URLSearchParams({ activityId: "https://example.org/a", agent, stateId: "LMS.LaunchData" });
      const results = [
        await send("PUT", `statements?statementId=${statement.id}`, statement),
        await send("GET", `statements?statementId=${statement.id}`),
        await send("GET", "statements?limit=5"),
        await send("PUT", `activities/state?${state}`, { a: 1 }),
        await send("DELETE", `activities/state?${new URLSearchParams({ activityId: "https://example.org/a", agent })}`),
        await send("GET", "about"),
      ];
      return results.map(({ status, body }) => [status, typeof body === "string" ? body.length : body.byteLength]);
    };
    expect(await answers(true)).toStrictEqual(await answers(false));
  });

  it("lets an account of the host read the statements of every learner and registration", async () => {
    const { host, launched } = await started();
    const answer = await host.xapi("GET", "statements?ascending=true", { authorization: LMS_CREDENTIAL });
    expect(answer.status).toBe(200);
    const { statements } = JSON.parse(String(answer.body)) as { statements: { context?: { registration?: string } }[] };
    expect(statements.some(({ context }) => context?.registration === launched.registration)).toBe(true);
  });
});
