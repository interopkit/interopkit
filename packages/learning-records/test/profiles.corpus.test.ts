import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { createProfileValidator, validateProfile } from "../src/profiles/index.js";

const corpus = requireCorpus(resolve(import.meta.dirname, "../../.."));

/** Reads a file of the corpus as text. */
function text(...path: string[]): string {
  return readFileSync(join(corpus, ...path), "utf8");
}

/** The rules that the errors of a profile break, each once, in order. */
function errorRules(profile: string): string[] {
  const rules = validateProfile(profile)
    .filter(({ severity }) => severity === "error")
    .map(({ rule }) => rule);
  return [...new Set(rules)].sort();
}

/**
 * The rules that each profile of ADL's repository of authored profiles breaks, as `validateProfile` finds them: none for a sound
 * profile. Each kind is described in docs/learning-records/spec-gaps.md, with the profiles that have it.
 */
const AUTHORED: ReadonlyMap<string, readonly string[]> = new Map([
  ["Profile_Server_Profiles/ADL_Vocabulary.jsonld", []],
  ["Profile_Server_Profiles/Academic Assessment.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/AcrossX Profile.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Actionable Data Book (ADB) Profile.jsonld", []],
  ["Profile_Server_Profiles/Activity Streams Vocabulary.jsonld", ["id-repeated"]],
  ["Profile_Server_Profiles/Audio_Profile.jsonld", ["pattern-kind"]],
  ["Profile_Server_Profiles/BOLL Profile.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Content Repository.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Core Profile.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Data security module.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/DoD_ISD.jsonld", []],
  ["Profile_Server_Profiles/EDA Course.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/EmotionAPI.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Feedback Interaction Profile.jsonld", ["json-path", "pattern-kind"]],
  ["Profile_Server_Profiles/Flashcards.jsonld", []],
  ["Profile_Server_Profiles/Flying Profile.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/GBLxAPI-K-12_Education_Apps_Profile.jsonld", []],
  ["Profile_Server_Profiles/General Vocabulary.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/GeoLocation.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Ground Training.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/HR Open Assessments.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/HyFlex classroom profile.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/IMS Global Learning Tool Interoperability.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Language Experiment.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Learning Management System.jsonld", []],
  ["Profile_Server_Profiles/MasterObjectModel.jsonld", ["empty-value", "revision-missing"]],
  ["Profile_Server_Profiles/NELC.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Navy Assessment Profile.jsonld", []],
  ["Profile_Server_Profiles/Navy Common Reference Profile.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Navy E-learning Profile.jsonld", []],
  ["Profile_Server_Profiles/Open edX.jsonld", []],
  ["Profile_Server_Profiles/Orphan Container Profile.jsonld", ["json-path"]],
  ["Profile_Server_Profiles/PDF Annotator.jsonld", []],
  ["Profile_Server_Profiles/Performance Support Profile.jsonld", []],
  ["Profile_Server_Profiles/SCORM Profile.jsonld", ["json-path"]],
  ["Profile_Server_Profiles/Serious Games Profile.jsonld", []],
  ["Profile_Server_Profiles/Simulation Base Profile.jsonld", []],
  ["Profile_Server_Profiles/Social Media.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/SurveyPOC.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Syllabus Events.jsonld", ["invalid-format"]],
  ["Profile_Server_Profiles/Task Trainer Simulation Profile.jsonld", []],
  ["Profile_Server_Profiles/TinCan Vocabulary.jsonld", ["id-repeated"]],
  ["Profile_Server_Profiles/Video Profile.jsonld", []],
  ["Profile_Server_Profiles/Virtual Patient Profile.jsonld", []],
  ["Profile_Server_Profiles/Virtual classroom.jsonld", []],
  ["Profile_Server_Profiles/cmi5 Profile.jsonld", ["pattern-kind"]],
  ["Profile_Server_Profiles/initializedhh_init.jsonld", []],
  ["Profile_Server_Profiles/xAPI_Open_Badges_Profile.jsonld", ["id-repeated"]],
  ["acrossx/acrossx.jsonld", []],
  ["acrossx/v1.0.1/acrossx.jsonld", ["related-deprecated", "relation-target"]],
  ["acrossx/v1.0/acrossx.jsonld", ["related-deprecated", "relation-target"]],
  ["activity-streams/activity-streams.jsonld", ["id-repeated", "in-scheme", "relation-target"]],
  ["adb/adb.jsonld", ["relation-target"]],
  ["adb/v1.0/adb.jsonld", ["invalid-format"]],
  ["adl/adl.jsonld", ["relation-target"]],
  ["adl/v1.0/adl.jsonld", ["relation-target"]],
  ["audio/audio.jsonld", []],
  ["audio/v1.0/audio.jsonld", []],
  ["cmi5/cmi5.jsonld", ["invalid-format", "missing-property"]],
  ["cmi5/v1.0/cmi5.jsonld", ["missing-property"]],
  ["competency_assertion/learnercompetencyassertion.json", []],
  ["dod-isd/dod-isd.jsonld", ["invalid-format"]],
  ["dod-isd/v1.0/dod-isd.jsonld", ["invalid-format"]],
  ["flashcards/v0.1/flashcards.jsonld", []],
  ["gblxapi/gblxapi.jsonld", []],
  ["gblxapi/v1.0/gblxapi.jsonld", []],
  ["open-badges/open-badges.jsonld", ["id-repeated"]],
  ["pdf-annotator/pdf-annotator.jsonld", ["in-scheme"]],
  ["pdf-annotator/v1.0/pdf-annotator.jsonld", ["in-scheme"]],
  ["scorm/scorm.jsonld", ["empty-value", "json-path"]],
  ["scorm/v1.0/scorm.jsonld", ["empty-value", "json-path"]],
  ["seriousgames/seriousgames.jsonld", []],
  ["seriousgames/v1.0/seriousgames.jsonld", []],
  ["starter-template.jsonld", ["invalid-format"]],
  ["tincan/tincan.jsonld", ["id-repeated", "in-scheme", "relation-target"]],
  ["video/v1.0.1/video.jsonld", []],
  ["video/v1.0.2/video.jsonld", []],
  ["video/v1.0.3/video.jsonld", []],
  ["video/v1.0/video.jsonld", []],
  ["video/video.jsonld", []],
  ["virtual-patient/v1.0/virtual-patient.jsonld", []],
  ["virtual-patient/virtual-patient.jsonld", []],
]);

describe("the profiles that ADL publishes", () => {
  it.each([...AUTHORED])("finds in %s the errors that it has", (file, rules) => {
    expect(errorRules(text("xapi-authored-profiles", file))).toStrictEqual(rules);
  });

  it("makes a validator of each sound profile whose primary Patterns name only what it defines", () => {
    let validators = 0;
    for (const [file, rules] of AUTHORED) {
      if (rules.length > 0) continue;
      const profile = text("xapi-authored-profiles", file);
      try {
        createProfileValidator(profile);
        validators += 1;
      } catch (caught) {
        expect(String(caught)).toMatch(/pass the profile that defines it in profiles/u);
      }
    }
    expect(validators).toBeGreaterThan(25);
  });
});

/**
 * What the tests of Yet Analytics' Pan find in its sample profiles (`pan_test.cljc`, `error-tests`): whether the syntax, the ids
 * and the relations are sound. Pan also asks that the Determining Properties of a template name concepts that a profile
 * defines, which the specification does not ask (docs/learning-records/comparators.md); the profiles where only that differs
 * are those whose relations Pan finds unsound and that `validateProfile` finds sound.
 */
const PAN: readonly (readonly [string, boolean, boolean, boolean])[] = [
  ["catch.json", false, false, false],
  ["cmi5.json", false, false, false],
  ["acrossx.json", false, true, false],
  ["activity_stream.json", false, false, false],
  ["tincan.json", true, false, false],
  ["video.json", true, true, false],
  ["mom.json", true, false, false],
  ["scorm.json", false, false, false],
  ["catch-fixed.json", true, true, true],
  ["cmi5-fixed.json", true, true, false],
];

/** The samples whose relations Pan finds unsound only because a Determining Property names a concept of no profile given. */
const PAN_DETERMINING_ONLY = new Set(["video.json", "cmi5-fixed.json"]);

describe("the sample profiles of Pan", () => {
  it.each(PAN)("finds %s sound when Pan finds its syntax, ids and relations sound", (file, syntax, ids, relations) => {
    const sound = errorRules(text("project-pan", "dev-resources", "sample_profiles", file)).length === 0;
    expect(sound).toBe(syntax && ids && (relations || PAN_DETERMINING_ONLY.has(file)));
  });
});

describe("the calibration profile and Statements of Persephone", () => {
  const resources = ["project-persephone", "test-resources"];
  const validator = createProfileValidator(text(...resources, "sample_profiles", "calibration.jsonld"));
  const statement = (name: string): unknown => JSON.parse(text(...resources, "sample_statements", `${name}.json`));
  const template = (n: number) => `https://xapinet.org/xapi/yet/calibration/v1/templates#activity-${n}`;

  it("finds the second Statement to follow the second template", () => {
    expect(validator.validateStatement(statement("calibration_2"))).toMatchObject({
      outcome: "success",
      templates: [template(2)],
    });
  });

  it("finds the first Statement invalid, since it matches the Determining Properties of the third template and breaks its rules", () => {
    expect(validator.validateStatement(statement("calibration_1"))).toMatchObject({
      outcome: "invalid",
      templates: [template(3)],
    });
  });

  it("leaves out the Statements of ADL's examples, which name no version of the profile", () => {
    const adl = ["adl_1", "adl_2", "adl_3", "adl_4"].map(statement);
    expect(validator.validateStatements(adl)).toStrictEqual({ issues: [], registrations: [] });
  });
});
