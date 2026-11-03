import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";
import { GLOSSARY, MINERALS, ROCKS } from "../src/course.ts";

describe("the scenario", () => {
  it("writes the course as a ZIP package that the LMS reads back with its files", async () => {
    expect((await runScenario()).imported).toStrictEqual({
      source: "zip",
      paths: ["cmi5.xml", "rocks/index.html", "glossary/index.html", "minerals/index.html"],
    });
  });

  it("satisfies at registration the glossary, which needs nothing", async () => {
    expect((await runScenario()).satisfiedAtRegistration).toBe(true);
  });

  it("records Ana's lesson, satisfies the block before terminated, and the administrator reads it in order", async () => {
    const { rocks, anaVerbs } = await runScenario();
    expect(rocks).toStrictEqual({
      recorded: ["recorded", "recorded", "recorded"],
      returnUrl: "https://lms.campus.example/courses/geology",
    });
    expect(anaVerbs).toStrictEqual(["launched", "initialized", "completed", "passed", "satisfied", "terminated"]);
  });

  it("skips what the rules forbid, and refuses a second start of the same launch", async () => {
    const { skipped, secondStart } = await runScenario();
    expect(skipped).toStrictEqual({ failedAfterPassed: "skipped", afterTerminated: "skipped" });
    expect(secondStart).toBe("used-or-expired");
  });

  it("resumes a session after a reload of its page, and skips the outcomes of a review", async () => {
    const { resumed, review } = await runScenario();
    expect(resumed).toBe("recorded");
    expect(review).toStrictEqual(["recorded", "skipped", "skipped"]);
  });

  it("refuses the old session of a unit that was launched again, and times its abandoned statement", async () => {
    const { abandoned } = await runScenario();
    expect(abandoned.oldSession).toBe("refused");
    expect(abandoned.duration).toMatch(/^PT\d+S$/u);
  });

  it("tells the progress of each registration: Ana's block and Budi's whole course", async () => {
    const { progress } = await runScenario();
    expect(progress.ana.aus.map(({ id, satisfied }) => [id, satisfied])).toStrictEqual([
      [ROCKS, true],
      [GLOSSARY, true],
      [MINERALS, false],
    ]);
    expect(progress.ana.satisfied).toBe(false);
    expect(progress.budi.aus.find(({ id }) => id === ROCKS)?.waived).toBe(true);
    expect(progress.budi.satisfied).toBe(true);
  });
});
