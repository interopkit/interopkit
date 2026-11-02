import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";

describe("the scenario", () => {
  it("refuses a request with no credential as unauthenticated and a write by a reading credential as not allowed", async () => {
    const { refused } = await runScenario();
    expect(refused).toStrictEqual({ withoutCredential: 401, dashboardWrite: 403 });
  });

  it("stores the three Statements of a course with ids that come from the event, and keeps one copy when the batch is sent again", async () => {
    const { ana, budi, held } = await runScenario();
    expect(ana.ids).toHaveLength(3);
    expect(new Set([...ana.ids, ...budi.ids]).size).toBe(6);
    expect(ana.resent).toBe(true);
    // Six of the courses, the mistake and the Statement that voids it, and the signed certificate.
    expect(held).toBe(9);
  });

  it("hides the Statement that was voided from a query by id, and returns it to a query for voided Statements", async () => {
    const { voided, anaVerbs, completions } = await runScenario();
    expect(voided).toStrictEqual({ asked: "undefined", askedAsVoided: "found" });
    // Budi completed the statistics course once; the mistaken completion was of another course and is voided.
    expect(completions.learners).toStrictEqual(["Ana", "Budi"]);
    expect(anaVerbs).toStrictEqual(["earned", "completed", "answered", "launched"]);
  });

  it("answers a query in pages and follows `more` until the last", async () => {
    const { completions } = await runScenario();
    expect(completions.pages).toBe(2);
  });

  it("sends a signed Statement with the certificate as an Attachment, and the dashboard verifies the signature and reads the data", async () => {
    const { certificate } = await runScenario();
    expect(certificate).toStrictEqual({ signatureValid: true, text: "Certificate of completion: Statistics 101" });
  });

  it("writes progress under the tag that was read, so that a stale copy does not overwrite a newer one", async () => {
    const { progress } = await runScenario();
    expect(progress).toStrictEqual(["written", "written", "precondition-failed", "precondition-failed"]);
  });

  it("merges a JSON write into the document that exists", async () => {
    const { preferences } = await runScenario();
    expect(preferences).toStrictEqual({ theme: "dark", language: "id" });
  });

  it("says what it speaks, gives the Person that the directory knows, and the Activity with the languages of every Statement", async () => {
    const { about, person, course } = await runScenario();
    expect(about).toStrictEqual({ version: ["2.0.0", "1.0.3"] });
    expect(person.name).toStrictEqual(["Ana", "Ana Putri"]);
    expect(person.mbox).toHaveLength(2);
    expect(course.definition?.name).toStrictEqual({ "en-US": "Statistics 101", "id-ID": "Statistika 101" });
  });
});
