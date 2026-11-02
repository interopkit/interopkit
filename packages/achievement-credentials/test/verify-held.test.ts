import { describe, expect, it } from "vitest";
import { addProof } from "../src/data-integrity/index.js";
import type { IssuableCredential } from "../src/index.js";
import { signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { ACHIEVEMENT, achievementCredential, clrCredential, endorsementCredential, PROFILE } from "./fixtures.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";
import { credentialWithStatus, LIST_URL, listJws, listWith, METHOD, NOW, signer, world } from "./status-fixtures.js";
import { ALL_PASSED, badge, detailOf, forge, idOf, jwsOf, outcomes } from "./verify-fixtures.js";

/** An endorsement of the issuer, as a compact JWS. */
const endorsementJws = (by = signer, id = "https://example.edu/endorsements/1") =>
  jwsOf({ ...endorsementCredential(), id }, by);

/** A forged endorsement: a good signature by a key that the issuer does not publish. */
const forgedEndorsement = () =>
  signCredentialJwt(endorsementCredential() as unknown as IssuableCredential, signerOf(KEYS.other), {
    jwk: KEYS.other.publicJwk,
  });

const subjectOf = (achievement: unknown) => ({
  ...(achievementCredential().credentialSubject as object),
  achievement,
});

describe("the endorsements of a credential", () => {
  it("are verified wherever the credential carries them: its own, its issuer's and its achievement's", async () => {
    const { options } = world();
    const [own, ofIssuer, ofAchievement] = await Promise.all([
      endorsementJws(signer, "https://example.edu/endorsements/1"),
      endorsementJws(signer, "https://example.edu/endorsements/2"),
      endorsementJws(signer, "https://example.edu/endorsements/3"),
    ]);
    const credential = {
      ...badge(),
      endorsementJwt: [own],
      issuer: { ...PROFILE, endorsementJwt: [ofIssuer] },
      credentialSubject: subjectOf({ ...ACHIEVEMENT, endorsementJwt: [ofAchievement] }),
    };
    const result = await verifyCredential(await jwsOf(credential), options);
    expect(result.verified).toBe(true);
    expect(result.endorsements.map(idOf)).toStrictEqual([
      "https://example.edu/endorsements/1",
      "https://example.edu/endorsements/2",
      "https://example.edu/endorsements/3",
    ]);
    expect(result.endorsements.every((endorsement) => endorsement.verified)).toBe(true);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
  });

  it("are verified when they are objects with a Data Integrity proof of their own", async () => {
    const contexts = memoryContexts();
    const clock = clockAt(NOW);
    const did = `did:key:${KEYS.ed25519.multikey}`;
    const endorsement = await addProof(
      { ...endorsementCredential(), issuer: { id: did, type: ["Profile"] } } as unknown as IssuableCredential,
      signerOf(KEYS.ed25519, `${did}#${KEYS.ed25519.multikey}`),
      { clock, contexts: contexts.load },
    );
    const { options } = world();
    const credential = { ...badge(), endorsement: [endorsement] };
    const result = await verifyCredential(await jwsOf(credential), { ...options, contexts: contexts.load });
    expect(result.endorsements).toHaveLength(1);
    expect(result.endorsements[0]?.verified).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("fail the credential when one is forged, and the result says which, with the credential's own checks intact", async () => {
    const { options } = world();
    const credential = { ...badge(), endorsementJwt: [await endorsementJws(), await forgedEndorsement()] };
    const result = await verifyCredential(await jwsOf(credential), options);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
    expect(result.endorsements.map(({ verified }) => verified)).toStrictEqual([true, false]);
    expect(outcomes(result.endorsements[1] as never)).toMatchObject({ proof: "passed", issuer: "failed" });
    expect(result.endorsements[1]?.credential).toBeUndefined();
    expect(result.verified).toBe(false);
    expect(result.credential).toBeDefined();
  });

  it("fail the credential when one is no JWS that a reader can open, which is a failure of its form", async () => {
    const { options } = world();
    const result = await verifyCredential(await jwsOf({ ...badge(), endorsementJwt: ["a.b.c"] }), options);
    expect(outcomes(result.endorsements[0] as never).format).toBe("failed");
    expect(result.endorsements[0]?.verified).toBe(false);
    expect(result.verified).toBe(false);
  });

  it("are no more than maxEndorsements for a credential, which is counted before any of them is looked at", async () => {
    const { options, requests } = world();
    const one = await endorsementJws();
    const jws = await jwsOf({ ...badge(), endorsementJwt: [one, one, one] });
    const result = await verifyCredential(jws, { ...options, maxEndorsements: 2 });
    expect(outcomes(result)).toMatchObject({ format: "failed", proof: "passed", schema: "skipped" });
    expect(detailOf(result, "format")).toContain("3 endorsements");
    expect(result.endorsements).toStrictEqual([]);
    expect(result.credential).toBeUndefined();
    expect(requests.filter((url) => url === ISSUER_URL)).toHaveLength(1);
  });

  it("are not followed for the endorsements that an endorsement carries, since Open Badges 9.2 has no step for them", async () => {
    const { options } = world();
    const endorsement = await jwsOf({
      ...endorsementCredential(),
      issuer: { ...PROFILE, endorsementJwt: [await forgedEndorsement()] },
    });
    const result = await verifyCredential(await jwsOf({ ...badge(), endorsementJwt: [endorsement] }), options);
    expect(result.endorsements[0]?.endorsements).toStrictEqual([]);
    expect(result.verified).toBe(true);
  });

  it("are about no recipient, so the recipient check is skipped for them and for a credential that is one", async () => {
    const { options } = world();
    const recipient = { id: "did:example:somebody-else" };
    const credential = { ...badge(), endorsementJwt: [await endorsementJws()] };
    const result = await verifyCredential(await jwsOf(credential), { ...options, recipient });
    expect(outcomes(result).recipient).toBe("failed");
    expect(outcomes(result.endorsements[0] as never).recipient).toBe("skipped");
    const alone = await verifyCredential(await endorsementJws(), { ...options, recipient });
    expect(outcomes(alone)).toStrictEqual(ALL_PASSED);
    expect(alone.verified).toBe(true);
  });

  it("are refreshed, each on its own, as Open Badges 9.2 says", async () => {
    const service = { id: "https://example.edu/refresh/endorsement", type: "1EdTechCredentialRefresh" };
    const refreshed = await jwsOf({ ...endorsementCredential(), name: "Refreshed endorsement" });
    const { options } = world({ [service.id]: refreshed });
    const endorsement = await jwsOf({ ...endorsementCredential(), refreshService: service });
    const result = await verifyCredential(await jwsOf({ ...badge(), endorsementJwt: [endorsement] }), options);
    expect(outcomes(result.endorsements[0] as never).refresh).toBe("passed");
    expect(result.endorsements[0]?.credential).toMatchObject({ name: "Refreshed endorsement" });
  });
});

const ISSUER_URL = "https://example.edu/issuers/1";

/** A CLR in a JWS, whose credentials are compact JWS, as CLR 7.2.4.1 asks. */
const clrJws = async (held: readonly string[], extra: Record<string, unknown> = {}) =>
  jwsOf({
    ...clrCredential(),
    ...extra,
    credentialSubject: { ...(clrCredential().credentialSubject as object), verifiableCredential: held },
  });

describe("the credentials that a CLR holds", () => {
  const heldBadge = (id: string, extra: Record<string, unknown> = {}) =>
    jwsOf({ ...badge(), id: `https://example.edu/credentials/${id}`, ...extra });

  it("are each verified as an Open Badges credential, and the CLR is verified with them", async () => {
    const { options } = world();
    const result = await verifyCredential(await clrJws([await heldBadge("1"), await heldBadge("2")]), options);
    expect(result.verified).toBe(true);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
    expect(result.nested).toHaveLength(2);
    expect(result.nested.every((held) => held.verified && outcomes(held).proof === "passed")).toBe(true);
    expect(result.nested.map(idOf)).toStrictEqual([
      "https://example.edu/credentials/1",
      "https://example.edu/credentials/2",
    ]);
  });

  it("fail the CLR when one is forged, and the others are still verified and reported", async () => {
    const { options } = world();
    const forged = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    const result = await verifyCredential(await clrJws([await heldBadge("1"), forged, await heldBadge("3")]), options);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
    expect(result.nested.map(({ verified }) => verified)).toStrictEqual([true, false, true]);
    expect(outcomes(result.nested[1] as never)).toMatchObject({ proof: "passed", issuer: "failed" });
    expect(result.verified).toBe(false);
  });

  it("are no more than maxNestedCredentials, which is counted before any of them is looked at", async () => {
    const { options } = world();
    const one = await heldBadge("1");
    const result = await verifyCredential(await clrJws([one, one, one]), { ...options, maxNestedCredentials: 2 });
    expect(outcomes(result).format).toBe("failed");
    expect(detailOf(result, "format")).toContain("holds 3 credentials");
    expect(result.nested).toStrictEqual([]);
  });

  it("are about the same person only as far as the CLR says: the recipient is checked on the CLR and not on them", async () => {
    const { options } = world();
    const recipient = { id: "did:example:learner" };
    const result = await verifyCredential(await clrJws([await heldBadge("1")]), { ...options, recipient });
    expect(outcomes(result).recipient).toBe("passed");
    expect(outcomes(result.nested[0] as never).recipient).toBe("skipped");
    expect(result.verified).toBe(true);
  });

  it("have their endorsements verified, so a forged one fails the credential and then the CLR", async () => {
    const { options } = world();
    const endorsed = await heldBadge("1", { endorsementJwt: [await forgedEndorsement()] });
    const result = await verifyCredential(await clrJws([endorsed]), options);
    expect(result.nested[0]?.endorsements[0]?.verified).toBe(false);
    expect(result.nested[0]?.verified).toBe(false);
    expect(result.verified).toBe(false);
  });

  it("do not have the credentials of a CLR that they are followed, since a CLR holds badges", async () => {
    const { options } = world();
    const forged = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    const inner = await clrJws([forged]);
    const result = await verifyCredential(await clrJws([inner]), options);
    expect(result.nested[0]?.nested).toStrictEqual([]);
    expect(result.nested[0]?.verified).toBe(true);
  });

  it("are refreshed no more than 16 times in one call, and the rest are verified as they are", async () => {
    const refreshing = (index: number) => ({
      ...badge(),
      id: `https://example.edu/credentials/${index}`,
      refreshService: { id: `https://example.edu/refresh/${index}`, type: "1EdTechCredentialRefresh" },
    });
    const indexes = Array.from({ length: 20 }, (_, index) => index);
    const routes = Object.fromEntries(
      await Promise.all(
        indexes.map(async (index) => [`https://example.edu/refresh/${index}`, await jwsOf(refreshing(index))]),
      ),
    );
    const { options, requests } = world(routes);
    const held = await Promise.all(indexes.map((index) => jwsOf(refreshing(index))));
    const result = await verifyCredential(await clrJws(held), options);
    const refreshes = result.nested.map((nested) => outcomes(nested).refresh);
    expect(refreshes.filter((outcome) => outcome === "passed")).toHaveLength(16);
    expect(refreshes.slice(16)).toStrictEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(requests.filter((url) => url.includes("/refresh/"))).toHaveLength(16);
    expect(result.verified).toBe(true);
  });

  it("share a status list that several name, which is fetched once for the call", async () => {
    const { options, requests } = world({ [LIST_URL]: await listJws(listWith()) });
    const entry = credentialWithStatus();
    const held = [
      await heldBadge("1", { credentialStatus: entry.credentialStatus }),
      await heldBadge("2", { credentialStatus: entry.credentialStatus }),
      await heldBadge("3", { credentialStatus: entry.credentialStatus }),
    ];
    const result = await verifyCredential(await clrJws(held), options);
    expect(result.verified).toBe(true);
    expect(requests.filter((url) => url === LIST_URL)).toHaveLength(1);
  });

  it("fail when one is a credential of another class, which no algorithm of Open Badges covers", async () => {
    const { options } = world();
    const other = await forge({ type: ["VerifiableCredential"], issuer: ISSUER_URL, iss: ISSUER_URL }, KEYS.es256);
    const result = await verifyCredential(await clrJws([other]), options);
    expect(outcomes(result.nested[0] as never).format).toBe("failed");
    expect(result.verified).toBe(false);
  });

  it("are verified when the CLR carries them as objects with proofs of their own", async () => {
    const contexts = memoryContexts();
    const clock = clockAt(NOW);
    const did = `did:key:${KEYS.ed25519.multikey}`;
    const by = signerOf(KEYS.ed25519, `${did}#${KEYS.ed25519.multikey}`);
    const issuer = { id: did, type: ["Profile"] };
    const sign = async (credential: unknown) =>
      await addProof(credential as IssuableCredential, by, { clock, contexts: contexts.load });
    const nested = await sign({ ...achievementCredential(), issuer });
    const clr = await sign({
      ...clrCredential(),
      issuer,
      credentialSubject: { ...(clrCredential().credentialSubject as object), verifiableCredential: [nested] },
    });
    const options = { keys: createKeyResolver({ clock }), clock, contexts: contexts.load };
    const result = await verifyCredential(clr, options);
    expect(result.verified).toBe(true);
    expect(result.nested).toHaveLength(1);
    expect(outcomes(result.nested[0] as never).proof).toBe("passed");
    const unsigned = await sign({
      ...clrCredential(),
      issuer,
      credentialSubject: {
        ...(clrCredential().credentialSubject as object),
        verifiableCredential: [{ ...achievementCredential(), issuer }],
      },
    });
    const refused = await verifyCredential(unsigned, options);
    expect(outcomes(refused)).toStrictEqual(ALL_PASSED);
    expect(outcomes(refused.nested[0] as never).proof).toBe("failed");
    expect(refused.verified).toBe(false);
  });

  it("are read from what readSvg returns for a CLR, as a JWS in the credential", async () => {
    const { options } = world();
    const baked = { kind: "clr", credential: await clrJws([await heldBadge("1")]) };
    expect((await verifyCredential(baked, options)).verified).toBe(true);
  });
});

void METHOD;
