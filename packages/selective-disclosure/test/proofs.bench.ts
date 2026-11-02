import { addBaseProof, deriveProof, selectiveDisclosureSuite } from "@interopkit/selective-disclosure";
import { expect, test } from "vitest";
import { BENCH_OPTIONS, expectRatioWithin } from "./budgets.js";
import { createSharedIssuer, dbDerive, dbSign, dbVerify } from "./digital-bazaar.js";
import { CREATED } from "./documents.js";
import { downloadedContexts } from "./downloads.js";
import { vcCredential } from "./vc-credential.js";

/** The achievements of the credential, and how many of them a disclosure reveals. */
const ACHIEVEMENTS = 12;
const REVEALED = 8;

const CONTEXTS = downloadedContexts();
const contexts = async (url: string) => structuredClone(CONTEXTS.get(url));
const MANDATORY_POINTERS = ["/issuer"];
const SELECTIVE_POINTERS = Array.from({ length: REVEALED }, (_, index) => `/credentialSubject/achievements/${index}`);

test("signs, derives and verifies a credential of 12 achievements as fast as Digital Bazaar's suite", async ({
  annotate,
  bench,
}) => {
  const issuer = await createSharedIssuer();
  const credential = vcCredential(ACHIEVEMENTS);
  const base = await addBaseProof(credential, {
    signer: issuer.signer,
    mandatoryPointers: MANDATORY_POINTERS,
    contexts,
    created: CREATED,
  });
  const disclosure = await deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts });
  const { proof, ...document } = disclosure;
  const verify = () =>
    selectiveDisclosureSuite.verify(document, proof as Record<string, unknown>, {
      publicKeyJwk: issuer.publicKeyJwk,
      contexts,
    });
  expect(await verify()).toBe(true);
  expect(await dbVerify(disclosure, issuer)).toBe(true);
  await annotate(`The credential has ${ACHIEVEMENTS} achievements, and the disclosure reveals ${REVEALED} of them.`);

  const roles = [
    {
      name: "addBaseProof",
      ours: () =>
        addBaseProof(credential, {
          signer: issuer.signer,
          mandatoryPointers: MANDATORY_POINTERS,
          contexts,
          created: CREATED,
        }),
      theirs: () => dbSign(credential, issuer, { mandatoryPointers: MANDATORY_POINTERS, created: CREATED }),
    },
    {
      name: "deriveProof",
      ours: () => deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts }),
      theirs: () => dbDerive(base, issuer, SELECTIVE_POINTERS),
    },
    { name: "verify", ours: verify, theirs: () => dbVerify(disclosure, issuer) },
  ] as const;
  for (const { name, ours, theirs } of roles) {
    const reference = await bench(`Digital Bazaar ${name}`, theirs).run(BENCH_OPTIONS);
    const result = await bench(name, ours).run(BENCH_OPTIONS);
    await expectRatioWithin(annotate, name, result, reference);
  }
});
