import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";
import { GLOSSARY, MINERALS, ROCKS } from "../src/course.ts";

describe("the scenario", () => {
  it("satisfies at registration the glossary, which needs nothing", async () => {
    expect((await runScenario()).satisfiedAtRegistration).toBe(true);
  });

  it("takes Ana's session, satisfies the block before terminated, and the administrator reads it in order", async () => {
    const { session, anaVerbs } = await runScenario();
    expect(session).toStrictEqual([204, 204, 204, 204]);
    expect(anaVerbs).toStrictEqual(["launched", "initialized", "completed", "passed", "satisfied", "terminated"]);
  });

  it("refuses a failed after a passed, a second fetch, and a statement after terminated", async () => {
    expect((await runScenario()).refused).toStrictEqual({
      failedAfterPassed: 403,
      secondFetch: "1",
      afterTerminated: 401,
    });
  });

  it("abandons Budi's open session of a unit when he launches it again, with the time to its last statement", async () => {
    expect((await runScenario()).abandonedDuration).toMatch(/^PT\d+S$/u);
  });

  it("tells the progress of each registration, a waived unit satisfied", async () => {
    const { progress } = await runScenario();
    expect(progress.ana.aus.map(({ id, satisfied }) => [id, satisfied])).toStrictEqual([
      [ROCKS, true],
      [GLOSSARY, true],
      [MINERALS, false],
    ]);
    expect(progress.ana.blocks).toStrictEqual([{ id: "https://publisher.example/geology/basics", satisfied: true }]);
    expect(progress.budi.aus.find(({ id }) => id === MINERALS)).toStrictEqual({
      id: MINERALS,
      completed: false,
      passed: false,
      waived: true,
      satisfied: true,
    });
    expect(progress.budi.satisfied).toBe(false);
  });
});
