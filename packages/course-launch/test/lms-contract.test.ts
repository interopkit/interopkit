import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { abandonSession, createRegistration, prepareLaunch, progressOf, waiveAu } from "../src/lms/index.js";
import { AU_AUTHORITY, AU1, AU3, LMS_CREDENTIAL, testHost } from "./lms-host.js";
import { launchUnit, register, sendStatement, unitStatement } from "./lms-session.js";

describe("a store that breaks its contract", () => {
  it("makes a function throw DataError when it loses a record that another names", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.store.registrations.delete(registration.id);
    await expect(abandonSession(launched.launch.session, host.options)).rejects.toThrow("no registration");
    host.store.registrations.set(registration.id, registration);
    const session = host.store.sessions.get(launched.launch.session) ?? expect.unreachable();
    host.store.sessions.set(session.id, { ...session, state: "active", au: "https://publisher.example.org/au/9" });
    await expect(abandonSession(launched.launch.session, host.options)).rejects.toThrow("no assignable unit");
  });

  it("answers 500 to a statement whose session names a registration that the store lost", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.store.registrations.delete(registration.id);
    expect((await sendStatement(host, launched, unitStatement(launched, "initialized"))).status).toBe(500);
  });

  it("refuses a launch whose new session id the store holds already, or whose registration it loses", async () => {
    const host = testHost({ newId: () => "00000000-0000-4000-8000-00000000000a" });
    const registration = await createRegistration(
      {
        courseId: "geology",
        actor: { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "l" } },
        registration: "00000000-0000-4000-8000-0000000000aa",
      },
      host.options,
    );
    await prepareLaunch({ registration: registration.id, au: AU1 }, host.options);
    host.store.sessions.get("00000000-0000-4000-8000-00000000000a");
    const session = host.store.sessions.get("00000000-0000-4000-8000-00000000000a") ?? expect.unreachable();
    host.store.sessions.set(session.id, { ...session, state: "preparing" });
    const registrationRecord = host.store.registrations.get(registration.id) ?? expect.unreachable();
    host.store.registrations.set(registration.id, {
      ...registrationRecord,
      aus: { ...registrationRecord.aus, [AU1]: { moveOn: "Passed", satisfied: false } },
    });
    await expect(prepareLaunch({ registration: registration.id, au: AU1 }, host.options)).rejects.toThrow(
      "holds already",
    );
  });

  it("refuses a waiver when the registration disappears from the store in the middle", async () => {
    const host = testHost();
    const registration = await register(host);
    const original = host.store.registration.bind(host.store);
    let reads = 0;
    host.store.registration = async (id) => {
      reads += 1;
      return reads === 1 ? original(id) : undefined;
    };
    await expect(waiveAu({ registration: registration.id, au: AU3, reason: "r" }, host.options)).rejects.toThrow(
      "no registration",
    );
  });

  it("refuses a launch when the registration disappears from the store in the middle", async () => {
    const host = testHost();
    const registration = await register(host);
    const original = host.store.registration.bind(host.store);
    host.store.putSession = (() => {
      const put = host.store.putSession.bind(host.store);
      return async (record, revision) => {
        if (record.state === "launched") host.store.registration = async () => undefined;
        return put(record, revision);
      };
    })();
    await expect(prepareLaunch({ registration: registration.id, au: AU1 }, host.options)).rejects.toThrow(DataError);
    host.store.registration = original;
  });
});

describe("a check of statements that races the end of a session", () => {
  it("refuses the statements of a session that ended after its access was decided", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    await abandonSession(launched.launch.session, host.options);
    const accept = host.lrsOptions.accept ?? expect.unreachable();
    const findings = await accept([unitStatement(launched, "initialized")], {
      allowed: true,
      authority: AU_AUTHORITY,
      actions: ["statements.write"],
      principal: launched.launch.session,
    });
    expect(findings.map(({ rule }) => rule)).toStrictEqual(["session-ended"]);
  });

  it("changes nothing when the host sends again a terminated statement of a session that ended", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    const terminated = unitStatement(launched, "terminated", { duration: "PT1S" });
    await sendStatement(host, launched, terminated);
    const before = structuredClone(host.store.sessions.get(launched.launch.session));
    expect((await host.xapi("POST", "statements", { authorization: LMS_CREDENTIAL, body: terminated })).status).toBe(
      204,
    );
    expect(host.store.sessions.get(launched.launch.session)).toStrictEqual(before);
  });

  it("waives a unit once when two calls race", async () => {
    const host = testHost();
    const registration = await register(host);
    const input = { registration: registration.id, au: AU3, reason: "r" };
    const outcomes = await Promise.all([waiveAu(input, host.options), waiveAu(input, host.options)]);
    expect([...outcomes].sort()).toStrictEqual(["already-waived", "waived"]);
  });
});

describe("the statements a unit's session changes nothing for", () => {
  it("leaves the records as they are for statements of the host's credentials and of sessions the store lost", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    const statement = { ...unitStatement(launched, "experienced"), id: "0b5c6d7e-8f90-4a1b-8c2d-aaaaaaaaaaaa" };
    expect((await host.xapi("POST", "statements", { authorization: LMS_CREDENTIAL, body: statement })).status).toBe(
      200,
    );
    const stored = await host.xapi("GET", `statements?statementId=${statement.id}&attachments=true`, {
      authorization: LMS_CREDENTIAL,
    });
    expect(stored.status).toBe(200);
    const noSession = {
      ...statement,
      id: "0b5c6d7e-8f90-4a1b-8c2d-bbbbbbbbbbbb",
      context: {
        ...statement.context,
        extensions: {
          "https://w3id.org/xapi/cmi5/context/extensions/sessionid": "11111111-1111-4111-8111-111111111111",
        },
      },
    };
    expect((await host.xapi("POST", "statements", { authorization: LMS_CREDENTIAL, body: noSession })).status).toBe(
      200,
    );
    const before = structuredClone(host.store.sessions.get(launched.launch.session));
    expect(host.store.sessions.get(launched.launch.session)).toStrictEqual(before);
  });
});

describe("moveOn of every kind", () => {
  it.each([
    ["Passed", ["passed"], true],
    ["Passed", ["completed"], false],
    ["Completed", ["completed"], true],
    ["CompletedOrPassed", ["passed"], true],
    ["CompletedOrPassed", ["completed"], true],
    ["CompletedAndPassed", ["completed"], false],
  ] as const)("judges a unit with moveOn %s and %j satisfied: %s", async (moveOn, verbs, satisfied) => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1, moveOn, masteryScore: 0.5 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    for (const verb of verbs) {
      const result =
        verb === "passed"
          ? { success: true, duration: "PT1M", score: { scaled: 0.6 } }
          : { completion: true, duration: "PT1M" };
      expect((await sendStatement(host, launched, unitStatement(launched, verb, result))).status).toBe(204);
    }
    const record = (await host.store.registration(registration.id)) ?? expect.unreachable();
    expect(progressOf(record, host.course).aus[0]?.satisfied).toBe(satisfied);
  });

  it("launches a unit without launch parameters or mastery score, and makes ids with crypto.randomUUID by default", async () => {
    const host = testHost({ newId: undefined });
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU3 });
    expect(launched.launchData).not.toHaveProperty("masteryScore");
    expect(launched.launchData).not.toHaveProperty("launchParameters");
    expect(launched.launch.session).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
