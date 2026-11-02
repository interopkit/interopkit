import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { type Clock, type Fetch, SYSTEM_RANDOM } from "@interopkit/core";
import type { HttpRequest } from "@interopkit/core/http";
import { describe, expect, it } from "vitest";
import { createStandInContexts } from "../src/contexts.ts";
import { createSigningKey } from "../src/keys.ts";
import { createNetwork, type Handler } from "../src/network.ts";
import { createVcApi } from "../src/vc-api.ts";

const ORIGIN = "https://vc-api.example.edu";
const clock: Clock = { now: () => Date.UTC(2026, 10, 2, 9) };

/** A service with an issuer of each kind, and a request builder that reaches it. */
async function service() {
  const contexts = await createStandInContexts();
  const edDsa = await createSigningKey("EdDSA");
  const hosts: Record<string, Handler> = {};
  const fetch: Fetch = createNetwork(hosts);
  const api = createVcApi({
    origin: ORIGIN,
    random: SYSTEM_RANDOM,
    verify: { keys: createKeyResolver({ clock, fetch }), clock, contexts, fetch },
    issuers: {
      revocable: {
        id: edDsa.did,
        algorithm: "EdDSA",
        signer: edDsa.signer(`${edDsa.did}#${edDsa.multikey}`),
        status: "revocation",
      },
    },
  });
  hosts[ORIGIN] = (request) => api.handle(request);
  const send = (method: string, path: string, body?: unknown) => {
    const request: HttpRequest = {
      method,
      url: `${ORIGIN}${path}`,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(body === undefined ? "" : JSON.stringify(body)),
    };
    return api.handle(request);
  };
  const credential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer: edDsa.did,
    credentialSubject: { id: "did:example:learner" },
  };
  return { api, send, credential, did: edDsa.did, fetch, contexts };
}

describe("the VC-API service", () => {
  it("answers 404 to a route it does not have and 405 to a method that the route does not take", async () => {
    const { send } = await service();
    expect((await send("GET", "/credentials")).status).toBe(404);
    expect((await send("GET", "/issuers/revocable/credentials/issue")).status).toBe(405);
    expect((await send("GET", "/issuers/revocable/credentials/issue")).headers.allow).toBe("POST");
    expect((await send("POST", "/issuers/nobody/credentials/issue", {})).status).toBe(404);
  });

  it("issues a credential of the issuer with the time it becomes valid and a place in its revocation list", async () => {
    const { send, credential } = await service();
    const answer = await send("POST", "/issuers/revocable/credentials/issue", { credential });
    expect(answer.status).toBe(201);
    const issued = JSON.parse(String(answer.body));
    expect(issued.validFrom).toBe("2026-11-02T09:00:00Z");
    expect(issued.credentialStatus).toMatchObject({
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListCredential: `${ORIGIN}/issuers/revocable/status/revocation/1`,
    });
    expect(issued.proof[0]).toMatchObject({ type: "DataIntegrityProof", cryptosuite: "eddsa-rdfc-2022" });
  });

  it("serves the list that it fills, and verifies a credential against it", async () => {
    const { send, credential } = await service();
    const issued = JSON.parse(
      String((await send("POST", "/issuers/revocable/credentials/issue", { credential })).body),
    );
    const list = await send("GET", "/issuers/revocable/status/revocation/1");
    expect(list.status).toBe(200);
    expect(JSON.parse(String(list.body)).type).toStrictEqual(["VerifiableCredential", "BitstringStatusListCredential"]);
    // The service reaches the list through the network of the test, which routes to itself.
    const verified = await send("POST", "/verifiers/default/credentials/verify", {
      verifiableCredential: issued,
      options: { checks: ["proof", "credentialStatus"] },
    });
    expect(verified.status).toBe(200);
    expect(JSON.parse(String(verified.body))).toMatchObject({ verified: true, checks: ["proof", "credentialStatus"] });
    expect((await send("GET", "/issuers/revocable/status/suspension/1")).status).toBe(200);
  });

  it("refuses a credential that names another issuer, an option it does not offer and a body that is no credential", async () => {
    const { send, credential } = await service();
    const other = { ...credential, issuer: "did:example:other" };
    expect((await send("POST", "/issuers/revocable/credentials/issue", { credential: other })).status).toBe(400);
    const type = { credential, options: { type: "Ed25519Signature2020" } };
    expect((await send("POST", "/issuers/revocable/credentials/issue", type)).status).toBe(400);
    const suite = { credential, options: { cryptosuite: "ecdsa-sd-2023" } };
    expect((await send("POST", "/issuers/revocable/credentials/issue", suite)).status).toBe(400);
    expect((await send("POST", "/issuers/revocable/credentials/issue", { credential: 5 })).status).toBe(400);
    const refused = await send("POST", "/verifiers/default/credentials/verify", { verifiableCredential: credential });
    expect(JSON.parse(String(refused.body))).toMatchObject({ verified: false, errors: [{ name: "proof" }] });
  });

  it("refuses a list of checks that names one it does not run, or none", async () => {
    const { send, credential } = await service();
    for (const checks of [["expiry"], [], "proof"]) {
      const answer = await send("POST", "/verifiers/default/credentials/verify", {
        verifiableCredential: credential,
        options: { checks },
      });
      expect(answer.status).toBe(400);
    }
  });

  it("derives nothing from a credential that holds no base proof", async () => {
    const { send, credential } = await service();
    const answer = await send("POST", "/holders/default/credentials/derive", { verifiableCredential: credential });
    expect(answer.status).toBe(400);
  });
});
