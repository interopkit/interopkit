import { describe, expect, it } from "vitest";
import type { IssuableCredential } from "../src/index.js";
import { readEntity } from "../src/index.js";
import { signCredentialJwt } from "../src/jwt/index.js";
import { handleCredentialsRequest } from "../src/provider/index.js";
import { achievementCredential, clrCredential, endorsementCredential } from "./fixtures.js";
import { KEYS, signerOf } from "./key-fixtures.js";
import { jsonOf, ROOTS, request, serving } from "./provider-fixture.js";
import { attacker, credentialWithStatus, ISSUER, world } from "./status-fixtures.js";
import { badge, jwsOf } from "./verify-fixtures.js";

const CREDENTIALS = `${ROOTS.badges}/credentials`;

/** A credential of the issuer that names a refresh service, a status list and a schema at addresses that a forger chose. */
function namingAddresses(): Record<string, unknown> {
  return {
    ...achievementCredential(),
    issuer: { id: ISSUER, type: ["Profile"] },
    refreshService: { id: "https://internal.example/refresh/1", type: "1EdTechCredentialRefresh" },
    credentialStatus: {
      id: "http://169.254.169.254/latest/meta-data#1",
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "1",
      statusListCredential: "http://169.254.169.254/latest/meta-data",
    },
    credentialSchema: [{ id: "https://127.0.0.1:8443/schema.json", type: "1EdTechJsonSchemaValidator2019" }],
  };
}

/** A provider that verifies with the issuer's world, and the requests that the verifier made. */
function verifying() {
  const issuer = world();
  const provider = serving("badges", { verify: issuer.options });
  return { ...provider, requests: issuer.requests };
}

const upsertJws = (options: Parameters<typeof handleCredentialsRequest>[1], jws: string) =>
  handleCredentialsRequest(request("POST", CREDENTIALS, { body: jws, type: "text/plain" }), options);

describe("the verification of a credential before it is stored", () => {
  it("stores a credential that the issuer signed with a key it publishes", async () => {
    const { options, held } = verifying();
    const jws = await jwsOf(badge());
    const response = await upsertJws(options, jws);
    expect(response.status).toBe(201);
    expect(held.credentials.get("learner-1")?.[0]?.received).toBe(jws);
  });

  it("refuses with 422 a forged credential, signed by a key that the issuer does not publish, and stores nothing", async () => {
    const { options, held } = verifying();
    const response = await upsertJws(options, await jwsOf(badge(), attacker));
    expect(response.status).toBe(422);
    const status = readEntity("imsx_StatusInfo", jsonOf(response));
    expect(status.imsx_codeMinor?.imsx_codeMinorField[0]?.imsx_codeMinorFieldValue).toBe("invalid_data");
    expect(status.imsx_description).toMatch(/^The credential does not verify: the proof check failed: /u);
    expect(held.credentials.size).toBe(0);
  });

  it("stores the forged credential when the host asks for no verification, which is the format check alone", async () => {
    const { options, held } = serving();
    expect((await upsertJws(options, await jwsOf(badge(), attacker))).status).toBe(201);
    expect(held.credentials.get("learner-1")).toHaveLength(1);
  });

  it("fetches nothing that a forged credential names, since its proof fails first", async () => {
    const { options, requests } = verifying();
    const response = await upsertJws(options, await jwsOf(namingAddresses(), attacker));
    expect(response.status).toBe(422);
    expect(requests.filter((url) => !url.startsWith(ISSUER))).toStrictEqual([]);
  });

  it("never follows the refresh service of an authentic credential, and never fetches an address that is not HTTPS", async () => {
    const { options, requests, held } = verifying();
    const response = await upsertJws(options, await jwsOf(namingAddresses()));
    expect(response.status).toBe(422);
    expect(requests).not.toContain("https://internal.example/refresh/1");
    expect(requests.filter((url) => url.startsWith("http://"))).toStrictEqual([]);
    expect(readEntity("imsx_StatusInfo", jsonOf(response)).imsx_description).toMatch(
      /the status check (failed|could not be made)/u,
    );
    expect(held.credentials.size).toBe(0);
  });

  it("names the check that could not be made, such as a status list that the issuer does not serve", async () => {
    const { options, held } = verifying();
    const response = await upsertJws(options, await jwsOf(credentialWithStatus()));
    expect(response.status).toBe(422);
    expect(readEntity("imsx_StatusInfo", jsonOf(response)).imsx_description).toMatch(
      /^The credential does not verify: the status check could not be made: /u,
    );
    expect(held.credentials.size).toBe(0);
  });

  it("refuses a credential with a forged endorsement, and says that the endorsement does not verify", async () => {
    const { options, held } = verifying();
    const forged = await signCredentialJwt(
      endorsementCredential() as unknown as IssuableCredential,
      signerOf(KEYS.other),
      {
        jwk: KEYS.other.publicJwk,
      },
    );
    const response = await upsertJws(options, await jwsOf({ ...badge(), endorsementJwt: [forged] }));
    expect(response.status).toBe(422);
    expect(readEntity("imsx_StatusInfo", jsonOf(response)).imsx_description).toMatch(
      /^The credential does not verify: an endorsement does not verify, as the issuer check failed: /u,
    );
    expect(held.credentials.size).toBe(0);
  });

  it("refuses a CLR that holds a forged credential, and says that a credential it holds does not verify", async () => {
    const issuer = world();
    const { options, held } = serving("clr", { verify: issuer.options });
    const forged = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    const clr = {
      ...clrCredential(),
      credentialSubject: { ...(clrCredential().credentialSubject as object), verifiableCredential: [forged] },
    };
    const response = await handleCredentialsRequest(
      request("POST", `${ROOTS.clr}/credentials`, { body: await jwsOf(clr), type: "text/plain" }),
      options,
    );
    expect(response.status).toBe(422);
    expect(readEntity("imsx_StatusInfo", jsonOf(response)).imsx_description).toMatch(
      /^The credential does not verify: a credential that it holds does not verify, as the issuer check failed: /u,
    );
    expect(held.credentials.size).toBe(0);
  });

  it("passes the signal of the provider to the verifier, and rejects with its reason when it aborts while a key is resolved", async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const hanging = (_url: string, call?: { readonly signal?: AbortSignal }) => {
      signals.push(call?.signal);
      return new Promise<never>(() => undefined);
    };
    const { options } = serving("badges", {
      signal: controller.signal,
      verify: { ...world().options, keys: { resolve: hanging, issuerKeys: hanging } },
    });
    const pending = upsertJws(options, await jwsOf(badge()));
    await expect.poll(() => signals.length).toBe(1);
    controller.abort(new Error("The client went away."));
    await expect(pending).rejects.toThrow("The client went away.");
    expect(signals[0]?.aborted).toBe(true);
  });
});
