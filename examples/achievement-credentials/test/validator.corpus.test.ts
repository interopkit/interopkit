import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import {
  buildAchievementCredential,
  buildClrCredential,
  type KeyResolver,
  type VerificationKey,
} from "@interopkit/achievement-credentials";
import { bakePng, bakeSvg } from "@interopkit/achievement-credentials/baking";
import {
  addProof,
  createContextLoader,
  deriveDisclosure,
  KNOWN_CONTEXTS,
} from "@interopkit/achievement-credentials/data-integrity";
import { signCredentialJwt } from "@interopkit/achievement-credentials/jwt";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { verifyCredential } from "@interopkit/achievement-credentials/verify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadList, schemaDirectory } from "../../../scripts/schemas.ts";
import { createSigningKey } from "../src/keys.ts";

const URL_OF_VALIDATOR = process.env.VALIDATOR_URL;
if (URL_OF_VALIDATOR === undefined)
  throw new Error("Set VALIDATOR_URL, or run pnpm validator, which starts the validator.");

const ROOT = resolve(import.meta.dirname, "../../..");
const FILES = new Map(loadList(ROOT).map(({ url, file }) => [url, file]));
/** The contexts of the credentials, as `pnpm schemas` downloaded them at their pins. */
const DOCUMENTS = new Map(
  [...KNOWN_CONTEXTS.keys()].map((url) => [
    url,
    JSON.parse(readFileSync(resolve(schemaDirectory(ROOT), FILES.get(url) ?? ""), "utf8")) as unknown,
  ]),
);
const contexts = createContextLoader({ documents: DOCUMENTS });
const NOW = Date.UTC(2026, 10, 1);
const clock = { now: () => NOW };

/** A PNG of one pixel and an SVG with no drawing, which a credential is baked into. */
const PIXEL = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

/** The part of the report of the validator that the tests read. */
interface Report {
  readonly summary: { readonly outcome: string };
  readonly errors: Record<string, unknown>;
  readonly fatals: Record<string, unknown>;
}

/** Sends a file to the validator, as a person does in its web page. */
async function validate(validator: string, body: string | Uint8Array<ArrayBuffer>, name: string): Promise<Report> {
  const form = new FormData();
  form.set("file", new Blob([body]), name);
  const response = await fetch(`${URL_OF_VALIDATOR}/api/validate?validatorId=${validator}`, {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Report;
}

/** What one input is expected to come to, at the validator and at `verifyCredential`. */
interface Case {
  readonly name: string;
  readonly validator: "OB30Inspector" | "CLR20Inspector";
  readonly file: string;
  readonly body: () => string | Uint8Array<ArrayBuffer>;
  /** The outcome of the validator. */
  readonly outcome: string;
  /** Whether `verifyCredential` verifies the same input, or `undefined` where it is not asked. */
  readonly verified?: boolean;
  /** The probe that the validator reports a problem from, when it reports one. */
  readonly probe?: string;
}

describe("the public validator of 1EdTech", () => {
  let server: Server;
  let cases: readonly Case[] = [];
  let keys: KeyResolver;

  beforeAll(async () => {
    const [ed, es] = [await createSigningKey("EdDSA"), await createSigningKey("ES256")];
    const [edMethod, esMethod] = [`${ed.did}#${ed.multikey}`, `${es.did}#${es.multikey}`];
    // The validator reads the key of a JWT at the address in its kid, over HTTP from the container to this host.
    server = createServer((_request, response) => {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ...es.publicKeyJwk, kid: "key-1" }));
    });
    await new Promise<void>((done) => server.listen(0, "0.0.0.0", done));
    const kid = `http://host.docker.internal:${(server.address() as { port: number }).port}/jwk`;
    const published: VerificationKey = { id: kid, publicKeyJwk: es.publicKeyJwk, relationships: [] };
    keys = { resolve: async (url) => (url === kid ? published : undefined), issuerKeys: async () => [] };

    const achievement = {
      id: "urn:uuid:5f1ea0a4-1d3d-4c0b-9f0e-6b6a1b3c8d11",
      type: ["Achievement"] as ["Achievement"],
      name: "Fractions",
      description: "Understands fractions as numbers.",
      criteria: { narrative: "Pass the final assessment." },
    };
    const badge = (issuer: string) =>
      buildAchievementCredential({
        id: "urn:uuid:9f3c5b3e-4d36-4c5e-8c87-1c2f3a0e7b11",
        issuer: { id: issuer, type: ["Profile"], name: "Example University" },
        validFrom: "2026-10-01T00:00:00Z",
        name: "Fractions badge",
        description: "Awarded for the course.",
        subject: { id: "did:example:learner" },
        achievement,
      });
    const clr = (issuer: string, held: unknown) =>
      buildClrCredential({
        id: "urn:uuid:7c1d2a44-2f0a-4d5e-9a63-0e5b8d2f6a01",
        issuer: { id: issuer, type: ["Profile"], name: "Example University" },
        validFrom: "2026-10-01T00:00:00Z",
        name: "Learner record",
        subject: { id: "did:example:learner" },
        credentials: [held],
      } as never);
    const signed = await addProof(badge(ed.did), ed.signer(edMethod), { clock, contexts });
    const jws = await signCredentialJwt(badge(es.did), es.signer(kid), { kid });
    const base = await addProof(badge(es.did), es.signer(esMethod), { clock, contexts, cryptosuite: "ecdsa-sd-2023" });
    const disclosure = await deriveDisclosure(base, { selectivePointers: ["/description"], contexts });
    const record = await addProof(clr(ed.did, signed) as never, ed.signer(edMethod), { clock, contexts });
    const edJws = await signCredentialJwt(badge(ed.did), ed.signer(edMethod), { kid: edMethod });
    const recordJws = await signCredentialJwt(clr(es.did, jws) as never, es.signer(kid), { kid });
    cases = [
      {
        name: "an achievement credential with an eddsa-rdfc-2022 proof",
        validator: "OB30Inspector",
        file: "badge.json",
        body: () => JSON.stringify(signed),
        outcome: "VALID",
        verified: true,
      },
      {
        name: "an achievement credential in a JWS signed with ES256",
        validator: "OB30Inspector",
        file: "badge.jwt",
        body: () => jws,
        outcome: "VALID",
      },
      {
        name: "an ecdsa-sd-2023 disclosure of an achievement credential",
        validator: "OB30Inspector",
        file: "disclosure.json",
        body: () => JSON.stringify(disclosure),
        outcome: "VALID",
        verified: true,
      },
      {
        name: "an achievement credential with a proof, baked into a PNG",
        validator: "OB30Inspector",
        file: "badge.png",
        body: () => new Uint8Array(bakePng(PIXEL, signed)),
        outcome: "VALID",
      },
      {
        name: "an achievement credential in a JWS, baked into a PNG",
        validator: "OB30Inspector",
        file: "badge-jws.png",
        body: () => new Uint8Array(bakePng(PIXEL, jws)),
        outcome: "VALID",
      },
      {
        name: "an achievement credential with a proof, baked into an SVG",
        validator: "OB30Inspector",
        file: "badge.svg",
        body: () => bakeSvg(DRAWING, signed),
        outcome: "VALID",
      },
      {
        name: "an achievement credential in a JWS, baked into an SVG",
        validator: "OB30Inspector",
        file: "badge-jws.svg",
        body: () => bakeSvg(DRAWING, jws),
        outcome: "VALID",
      },
      {
        name: "a CLR with an eddsa-rdfc-2022 proof, which holds a credential of its own proof",
        validator: "CLR20Inspector",
        file: "record.json",
        body: () => JSON.stringify(record),
        outcome: "VALID",
        verified: true,
      },
      {
        name: "an achievement credential whose name changed after it was signed",
        validator: "OB30Inspector",
        file: "changed.json",
        body: () => JSON.stringify({ ...signed, name: "Another badge" }),
        outcome: "ERROR",
        probe: "EmbeddedProofProbe",
        verified: false,
      },
      {
        name: "an achievement credential in a JWS signed with EdDSA, which the validator reads for RS256 and ES256 only",
        validator: "OB30Inspector",
        file: "ed.jwt",
        body: () => edJws,
        outcome: "FATAL",
        probe: "ExternalProofProbe",
      },
      {
        name: "a CLR in a JWS, which the validator does not parse: its CLR inspector leaves a setting of the JWT unset",
        validator: "CLR20Inspector",
        file: "record.jwt",
        body: () => recordJws,
        outcome: "EXCEPTION",
        probe: "CredentialParseProbe",
      },
    ];
  });

  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("gives each input the outcome that the table of the guide lists, and the same verdict as verifyCredential", async () => {
    expect(cases.length).toBeGreaterThan(0);
    const resolver = createKeyResolver({ clock });
    for (const { name, validator, file, body, outcome, probe, verified } of cases) {
      const report = await validate(validator, body(), file);
      expect(report.summary.outcome, name).toBe(outcome);
      if (probe !== undefined) expect(JSON.stringify({ ...report.errors, ...report.fatals }), name).toContain(probe);
      if (verified === undefined) continue;
      const input = JSON.parse(String(body()));
      const result = await verifyCredential(input, { keys: resolver, clock, contexts });
      expect(result.verified, name).toBe(verified);
    }
  });

  it("reads the credentials in a JWS and in an image as verifyCredential does, with the key at the address of the kid", async () => {
    for (const { file, body } of cases.filter(({ outcome, file }) => outcome === "VALID" && file.endsWith(".jwt"))) {
      const result = await verifyCredential(String(body()), { keys, clock, contexts, allowUnboundKeys: true });
      expect(result.verified, file).toBe(true);
    }
  });
});
