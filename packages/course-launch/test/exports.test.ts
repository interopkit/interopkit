import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";
import * as coursePackage from "../src/package/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "CMI5_ACTIVITY_TYPES",
        "CMI5_CATEGORIES",
        "CMI5_EXTENSIONS",
        "CMI5_VERBS",
        "COURSE_STRUCTURE_NAMESPACE",
        "LAUNCH_DATA_STATE_ID",
        "LAUNCH_METHODS",
        "LAUNCH_MODES",
        "LEARNER_PREFERENCES_PROFILE_ID",
        "MOVE_ON_VALUES",
        "readCourseStructure",
        "validateCourseStructure",
        "writeCourseStructure",
      ].sort(),
    );
  });

  it("exports from the subpath only what it documents", () => {
    expect(Object.keys(coursePackage).sort()).toStrictEqual(["readCoursePackage", "writeCoursePackage"]);
  });
});
