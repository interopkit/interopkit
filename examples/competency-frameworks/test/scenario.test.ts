import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";

describe("the scenario", () => {
  it("lists the ministry's documents sorted by title, and filters them by a word in the title", async () => {
    const { listing, filtered } = await runScenario();
    expect(listing).toStrictEqual(["English Language Arts, Grade 3", "Mathematics, Grade 3"]);
    expect(filtered).toStrictEqual(["Mathematics, Grade 3"]);
  });

  it("fetches both frameworks the first time, and the one the ministry changed the second time, and none the third", async () => {
    const { firstSync, secondSync, thirdSync } = await runScenario();
    expect(firstSync).toStrictEqual({
      fetched: ["Mathematics, Grade 3", "English Language Arts, Grade 3"],
      current: [],
    });
    expect(secondSync).toStrictEqual({
      fetched: ["Mathematics, Grade 3"],
      current: ["English Language Arts, Grade 3"],
    });
    expect(thirdSync).toStrictEqual({
      fetched: [],
      current: ["Mathematics, Grade 3", "English Language Arts, Grade 3"],
    });
  });

  it("outlines the framework by its tree, in the order of teaching", async () => {
    const { outline } = await runScenario();
    expect(outline.map((line) => line.trimStart().split(" ").slice(0, 2).join(" "))).toStrictEqual([
      "NF Develop",
      "NF.1 Understand",
      "NF.2 Represent",
      "NF.3 Explain",
      "MD Solve",
      "MD.1 Tell",
    ]);
    expect(outline.map((line) => line.length - line.trimStart().length)).toStrictEqual([0, 2, 2, 2, 0, 2]);
  });

  it("aligns the pacing guide of the district with the standards it matches", async () => {
    const { alignments } = await runScenario();
    expect(alignments).toStrictEqual(["U4 exactMatchOf NF.2", "U4 isRelatedTo NF.1", "U5 exactMatchOf MD.1"]);
  });

  it("refuses a consumer with no credential as unauthenticated and one with a wrong credential as not allowed", async () => {
    const { refused } = await runScenario();
    expect(refused).toStrictEqual({ withoutCredential: 401, wrongCredential: 403 });
  });

  it("finds what the second edition added, changed and replaced", async () => {
    const { changes } = await runScenario();
    expect(changes.added.map((line) => line.split(" ")[0])).toStrictEqual(["NF.4", "MD.2"]);
    expect(changes.changed.map((line) => line.split(" ")[0])).toStrictEqual(["NF.3", "MD.1"]);
    expect(changes.replaced).toStrictEqual(["MD.1 by MD.2"]);
  });

  it("gives a consumer of CASE 1.0 the framework without what 1.0 cannot say", async () => {
    const { associationsByVersion, frameworkTypeByVersion } = await runScenario();
    expect(frameworkTypeByVersion).toStrictEqual({ "1.0": false, "1.1": true });
    // The translation and the exemplar in another kind of system are associations that 1.0 has no words for.
    expect(associationsByVersion).toStrictEqual({ "1.0": 12, "1.1": 14 });
  });

  it("answers a call for an identifier the provider does not hold with undefined", async () => {
    expect((await runScenario()).unknownItem).toBe("undefined");
  });
});
