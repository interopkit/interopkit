import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";

describe("the scenario", () => {
  it("keeps the credentials that the learner uploads, and refuses one that a forger signed in the university's name", async () => {
    const { uploads, forgedUpload } = await runScenario();
    expect(uploads).toStrictEqual(["created", "created"]);
    expect(forgedUpload).toBe(422);
  });

  it("shows the employer both credentials as verified, each with the issuer named", async () => {
    const { review } = await runScenario();
    // The list of the API holds the credentials that are objects before those that are compact JWS.
    expect(review).toStrictEqual([
      { name: "Algebra badge", issuer: "Example University", verified: true, failed: [] },
      { name: "Fractions badge", issuer: "Example University", verified: true, failed: [] },
    ]);
  });

  it("fails the status of the credential that the university revoked, and no other check", async () => {
    const { afterRevocation } = await runScenario();
    expect(afterRevocation).toStrictEqual([
      { name: "Algebra badge", issuer: "Example University", verified: false, failed: ["status"] },
      { name: "Fractions badge", issuer: "Example University", verified: true, failed: [] },
    ]);
  });

  it("shows the reissued credential under its new name when the employer holds the old copy", async () => {
    const { refreshed } = await runScenario();
    expect(refreshed).toStrictEqual({
      name: "Fractions badge, level 2",
      issuer: "Example University",
      verified: true,
      failed: [],
    });
  });

  it("verifies the credential that it reads out of a baked PNG and a baked SVG", async () => {
    const { images } = await runScenario();
    expect(images.png).toStrictEqual(images.svg);
    expect(images.png).toMatchObject({ name: "Fractions badge, level 2", verified: true });
  });

  it("verifies an Open Badges 2.0 badge that a guild hosts, at its address", async () => {
    expect((await runScenario()).badgeV2).toStrictEqual({ name: "Welding", verified: true });
  });

  it("issues, verifies and refuses through the VC-API service, and derives a disclosure that it verifies", async () => {
    expect((await runScenario()).vcApi).toStrictEqual({
      issued: 201,
      verified: 200,
      verifiedAfterRename: 400,
      baseProofIssued: 201,
      // A base proof holds what the holder hides, so it never reaches a verifier.
      baseProofVerified: 400,
      disclosureDerived: 201,
      disclosureVerified: 200,
    });
  });
});
