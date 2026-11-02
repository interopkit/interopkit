import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CMI5_REQUIREMENTS } from "../../../scripts/cmi5-requirements.js";
import { catapult } from "./cmi5-corpus.js";

/** The requirements of cmi5 that CATAPULT lists, by id, at its pinned commit. */
const LISTED: Readonly<Record<string, { readonly txt: string }>> = JSON.parse(
  readFileSync(join(catapult(), "requirements/requirements.json"), "utf8"),
);

describe("the map of the requirements of cmi5", () => {
  it("has one row for each requirement that CATAPULT lists, and names no other", () => {
    const mapped = CMI5_REQUIREMENTS.flatMap(({ ids }) => ids);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toStrictEqual(Object.keys(LISTED).sort());
  });

  it("names tests that exist for every requirement it has or meets in part", () => {
    for (const { met } of CMI5_REQUIREMENTS) {
      if (met.state === "excluded") continue;
      for (const test of met.tests) expect(existsSync(new URL(test, import.meta.url)), test).toBe(true);
      if (met.state !== "planned") expect(met.tests.length).toBeGreaterThan(0);
    }
  });

  it("gives a reason for every requirement it excludes or meets in part", () => {
    for (const { met } of CMI5_REQUIREMENTS) {
      if (met.state === "excluded" || met.state === "in-part") expect(met.reason.length).toBeGreaterThan(0);
    }
  });
});
