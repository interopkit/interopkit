import { InteropkitError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { abandonSession, createRegistration, prepareLaunch, progressOf, waiveAu } from "../src/lms/index.js";
import { AU1, AU3, LEARNER, testHost } from "./lms-host.js";
import { launchUnit, register, sendStatement, statementsOf, unitStatement, verbsOf } from "./lms-session.js";

describe("a store that fails", () => {
  it("rejects a function with the failure, and answers 500 for a request whose access or check fails", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.store.failing.add("course");
    await expect(prepareLaunch({ registration: registration.id, au: AU1 }, host.options)).rejects.toThrow(
      "The store failed.",
    );
    host.store.failing = new Set(["session"]);
    expect((await sendStatement(host, launched, unitStatement(launched, "initialized"))).status).toBe(500);
    host.store.failing = new Set(["putSession"]);
    expect((await sendStatement(host, launched, unitStatement(launched, "initialized"))).status).toBe(500);
  });

  it("retries a write that met a conflict, and gives up with InteropkitError after the retries", async () => {
    const host = testHost({ conflictRetries: 2 });
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.store.conflicts.session = 2;
    expect((await sendStatement(host, launched, unitStatement(launched, "initialized"))).status).toBe(204);
    host.store.conflicts.registration = 3;
    await expect(waiveAu({ registration: registration.id, au: AU3, reason: "r" }, host.options)).rejects.toThrow(
      InteropkitError,
    );
    host.store.conflicts.registration = 0;
    expect(await waiveAu({ registration: registration.id, au: AU3, reason: "r" }, host.options)).toBe("waived");
  });

  it("takes again a statement whose registration write met a conflict, judging it as the first time", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    host.store.conflicts.registration = 1;
    const completed = unitStatement(launched, "completed", { completion: true, duration: "PT1M" });
    expect((await sendStatement(host, launched, completed)).status).toBe(204);
    expect((await host.store.registration(registration.id))?.aus[AU1]?.completed).toStrictEqual({
      statement: completed.id,
      stored: true,
    });
  });
});

describe("an LRS that fails", () => {
  it("leaves a launch preparing and returns no URL when the launch data or the launched statement are not written", async () => {
    const host = testHost();
    const registration = await register(host);
    host.recordsFail.putDocument = 1;
    await expect(prepareLaunch({ registration: registration.id, au: AU1 }, host.options)).rejects.toThrow(
      "The LRS failed.",
    );
    host.recordsFail.sendStatement = 1;
    await expect(prepareLaunch({ registration: registration.id, au: AU1 }, host.options)).rejects.toThrow(
      "The LRS failed.",
    );
    host.recordsFail.putOutcome = "precondition-failed";
    await expect(prepareLaunch({ registration: registration.id, au: AU1 }, host.options)).rejects.toThrow(
      InteropkitError,
    );
    expect([...host.store.sessions.values()].map(({ state }) => state)).toStrictEqual([
      "preparing",
      "preparing",
      "preparing",
    ]);
    expect((await host.store.registration(registration.id))?.aus[AU1]?.session).toBeUndefined();
    host.recordsFail.putOutcome = "written";
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    expect(launched.launchData.launchMode).toBe("Normal");
    expect(await abandonSession("00000000-0000-4000-8000-000000000002", host.options)).toBe("already-ended");
  });

  it("answers 500 when a satisfied statement is not written, and writes it when the unit sends its statement again", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    await sendStatement(host, launched, unitStatement(launched, "completed", { completion: true, duration: "PT1M" }));
    const passed = unitStatement(launched, "passed", { success: true, duration: "PT1M", score: { scaled: 0.9 } });
    host.recordsFail.sendStatement = 1;
    expect((await sendStatement(host, launched, passed)).status).toBe(500);
    expect(verbsOf(await statementsOf(host, registration.id))).toStrictEqual([
      "launched",
      "initialized",
      "completed",
      "passed",
    ]);
    expect((await sendStatement(host, launched, passed)).status).toBe(204);
    expect(verbsOf(await statementsOf(host, registration.id))).toStrictEqual([
      "launched",
      "initialized",
      "completed",
      "passed",
      "satisfied",
    ]);
  });

  it("takes the resend of a batch that the store did not hold, judged as the first time", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU3 });
    const batch = [
      unitStatement(launched, "initialized"),
      unitStatement(launched, "experienced"),
      unitStatement(launched, "terminated", { duration: "PT1M" }),
    ];
    host.lrs.failInsert = 1;
    const authorization = launched.authorization;
    expect((await host.xapi("POST", "statements", { authorization, body: batch })).status).toBe(500);
    expect((await host.xapi("POST", "statements", { authorization, body: batch })).status).toBe(200);
    expect((await host.store.session(launched.launch.session))?.state).toBe("terminated");
  });

  it("takes a completed in a later session when the LRS never stored the one that an ended session reserved", async () => {
    const host = testHost();
    const registration = await register(host);
    const first = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, first, unitStatement(first, "initialized"));
    host.lrs.failInsert = 1;
    const lost = unitStatement(first, "completed", { completion: true, duration: "PT1M" });
    expect((await sendStatement(host, first, lost)).status).toBe(500);
    const second = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, second, unitStatement(second, "initialized"));
    const completed = unitStatement(second, "completed", { completion: true, duration: "PT1M" });
    expect((await sendStatement(host, second, completed)).status).toBe(204);
    expect((await host.store.registration(registration.id))?.aus[AU3]?.completed).toStrictEqual({
      statement: completed.id,
      stored: true,
    });
    expect(verbsOf(await statementsOf(host, registration.id))).toStrictEqual([
      "launched",
      "initialized",
      "abandoned",
      "launched",
      "initialized",
      "completed",
    ]);
  });

  it("refuses a second completed when the LRS holds one that the LMS failed to mark as stored", async () => {
    const host = testHost({ conflictRetries: 1 });
    const registration = await register(host);
    const first = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, first, unitStatement(first, "initialized"));
    const completed = unitStatement(first, "completed", { completion: true, duration: "PT1M" });
    // accept writes the registration once; the wrapped insert then meets a conflict at every try.
    const put = host.store.putRegistration.bind(host.store);
    let puts = 0;
    host.store.putRegistration = async (record, revision) => {
      puts += 1;
      return puts === 1 ? put(record, revision) : "conflict";
    };
    expect((await sendStatement(host, first, completed)).status).toBe(500);
    host.store.putRegistration = put;
    expect((await host.store.registration(registration.id))?.aus[AU3]?.completed?.stored).toBe(false);
    const second = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, second, unitStatement(second, "initialized"));
    const again = await sendStatement(
      host,
      second,
      unitStatement(second, "completed", { completion: true, duration: "PT1M" }),
    );
    expect(again.status).toBe(403);
    expect(String(again.body)).toContain("a second completed in the registration");
  });

  it("writes an abandoned statement once when a call is made again after the LRS failed", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.recordsFail.sendStatement = 1;
    await expect(abandonSession(launched.launch.session, host.options)).rejects.toThrow("The LRS failed.");
    expect(await abandonSession(launched.launch.session, host.options)).toBe("already-ended");
    expect(verbsOf(await statementsOf(host, registration.id))).toStrictEqual(["launched", "abandoned"]);
  });
});

describe("registrations", () => {
  it("returns a registration that exists for the same learner and course, and refuses one of another learner", async () => {
    const host = testHost();
    const first = await register(host);
    expect(await register(host, first.id)).toStrictEqual(first);
    const other = { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "learner-2" } } as const;
    await expect(
      createRegistration({ courseId: "geology", actor: other, registration: first.id }, host.options),
    ).rejects.toThrow("exists already");
  });

  it("returns the registration that won a race to the store", async () => {
    const host = testHost();
    host.store.conflicts.registration = 1;
    const id = "7a0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d";
    host.store.registrations.set(id, {
      id,
      course: "geology",
      actor: LEARNER,
      revision: 1,
      aus: {},
      satisfiedBlocks: [],
      satisfied: false,
    });
    const original = host.store.registration.bind(host.store);
    let reads = 0;
    host.store.registration = async (key) => {
      reads += 1;
      return reads === 1 ? undefined : original(key);
    };
    expect((await register(host, id)).revision).toBe(1);
    reads = 0;
    host.store.registrations.clear();
    host.store.conflicts.registration = 1;
    await expect(register(host, id)).rejects.toThrow("holds none");
  });

  it("refuses a course that the store does not hold, and a registration whose units the store lost", async () => {
    const host = testHost();
    await expect(createRegistration({ courseId: "nothing", actor: LEARNER }, host.options)).rejects.toThrow(
      "no course",
    );
    const registration = await register(host);
    expect(() => progressOf({ ...registration, aus: {} }, host.course)).toThrow("holds no assignable unit");
  });
});
