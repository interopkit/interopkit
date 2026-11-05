import { readFileSync } from "node:fs";
import { ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { hashIdentifier } from "../src/issue/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { OFFICIAL_SCHEMA_IDS } from "../src/model/internal.js";
import { createStatusListCache } from "../src/status/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { achievementCredential, clrCredential, endorsementCredential } from "./fixtures.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";
import {
  attacker,
  credentialWithStatus,
  ISSUER,
  LIST_URL,
  listJws,
  listWith,
  NOW,
  signer,
  world,
} from "./status-fixtures.js";
import { ALL_PASSED, badge, detailOf, forge, jwsOf, outcomes } from "./verify-fixtures.js";

const SCHEMA_URL = "https://example.edu/schemas/badge.json";
const OFFICIAL = "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json";
const REFRESH_URL = "https://example.edu/refresh/1";
const SCHEMA_TYPE = "1EdTechJsonSchemaValidator2019";

/** A credential that names the schemas, which an issuer writes in `credentialSchema`. */
const naming = (...ids: string[]) => ({
  ...achievementCredential(),
  credentialSchema: ids.map((id) => ({ id, type: SCHEMA_TYPE })),
});

const DRAFT = "https://json-schema.org/draft/2019-09/schema";

describe("the schema that a credential names", () => {
  it("is skipped when the credential names none, or none of the type that Open Badges 9 checks", async () => {
    const { options } = world();
    expect(outcomes(await verifyCredential(await jwsOf(), options)).schema).toBe("skipped");
    const other = { ...achievementCredential(), credentialSchema: [{ id: SCHEMA_URL, type: "JsonSchema" }] };
    expect(outcomes(await verifyCredential(await jwsOf(other), options)).schema).toBe("skipped");
  });

  it("passes for a schema of 1EdTech without a request, since the readers check what those schemas say", async () => {
    const { options, requests } = world();
    const result = await verifyCredential(await jwsOf(naming(OFFICIAL)), options);
    expect(outcomes(result)).toStrictEqual({ ...ALL_PASSED, schema: "passed" });
    expect(requests).not.toContain(OFFICIAL);
  });

  it("passes for another schema that the credential conforms to, which is fetched", async () => {
    const schema = { $schema: DRAFT, type: "object", required: ["id", "type"] };
    const { options, requests } = world({ [SCHEMA_URL]: schema });
    const result = await verifyCredential(await jwsOf(naming(SCHEMA_URL)), options);
    expect(outcomes(result).schema).toBe("passed");
    expect(requests).toContain(SCHEMA_URL);
    expect(result.verified).toBe(true);
  });

  it("fails for a schema that the credential does not conform to, and names the schema and the property", async () => {
    const schema = { $schema: DRAFT, type: "object", required: ["name"] };
    const { options } = world({ [SCHEMA_URL]: schema });
    const result = await verifyCredential(await jwsOf(naming(SCHEMA_URL)), options);
    expect(outcomes(result).schema).toBe("failed");
    expect(detailOf(result, "schema")).toContain(SCHEMA_URL);
    expect(detailOf(result, "schema")).toContain("name");
    expect(result.verified).toBe(false);
  });

  it("is judged by the draft that $schema names", async () => {
    const draft7 = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      dependencies: { id: ["name"] },
    };
    const { options } = world({ [SCHEMA_URL]: draft7 });
    expect(outcomes(await verifyCredential(await jwsOf(naming(SCHEMA_URL)), options)).schema).toBe("failed");
  });

  it.each([
    ["is not served", {}],
    ["is not JSON", { [SCHEMA_URL]: "not json" }],
    ["is not an object", { [SCHEMA_URL]: "[1]" }],
    ["holds a regular expression", { [SCHEMA_URL]: { type: "object", properties: { id: { pattern: "^(a+)+$" } } } }],
    ["holds patternProperties", { [SCHEMA_URL]: { type: "object", patternProperties: { "^x": {} } } }],
    [
      "holds a format, which the validator checks by a regular expression",
      { [SCHEMA_URL]: { properties: { id: { format: "url" } } } },
    ],
    ["refers to another document", { [SCHEMA_URL]: { $ref: "https://example.edu/schemas/other.json" } }],
  ])("is unavailable when it %s, and a host may accept that", async (_name, routes) => {
    const { options } = world(routes);
    const jws = await jwsOf(naming(SCHEMA_URL));
    const result = await verifyCredential(jws, options);
    expect(outcomes(result).schema).toBe("unavailable");
    expect(result.verified).toBe(false);
    expect((await verifyCredential(jws, { ...options, unavailable: "warn" })).verified).toBe(true);
  });

  it("names the regular expression as the reason, since no pattern of a schema that the credential names is run", async () => {
    const { options } = world({ [SCHEMA_URL]: { properties: { id: { pattern: "^(a+)+$" } } } });
    const result = await verifyCredential(await jwsOf(naming(SCHEMA_URL)), options);
    expect(detailOf(result, "schema")).toContain("regular expressions");
  });

  it("is unavailable when no fetch was given, when the address is not HTTPS, and when the schema is too large or nests too deep", async () => {
    const { keys, clock, options } = world({ [SCHEMA_URL]: { type: "object" } });
    const jws = await jwsOf(naming(SCHEMA_URL));
    expect(detailOf(await verifyCredential(jws, { keys, clock }), "schema")).toContain("no fetch was given");
    const insecure = await jwsOf(naming("http://example.edu/schemas/badge.json"));
    expect(detailOf(await verifyCredential(insecure, options), "schema")).toContain("HTTPS");
    const large = await verifyCredential(jws, { ...options, maxBytes: 5 });
    expect(outcomes(large).schema).toBe("unavailable");
    const deep = world({
      [SCHEMA_URL]: { type: "object", properties: { a: { properties: { b: { properties: {} } } } } },
    });
    expect(outcomes(await verifyCredential(jws, { ...deep.options, maxDepth: 5 })).schema).toBe("unavailable");
    expect(outcomes(await verifyCredential(jws, { ...deep.options, maxDepth: 64 })).schema).toBe("passed");
  });

  it("is unavailable when the validator cannot use it, such as a schema whose id is no address", async () => {
    const { options } = world({ [SCHEMA_URL]: { $id: "http://[", type: "object" } });
    const result = await verifyCredential(await jwsOf(naming(SCHEMA_URL)), options);
    expect(outcomes(result).schema).toBe("unavailable");
    expect(detailOf(result, "schema")).toContain("cannot be used");
  });

  it("rejects with the reason of a signal that aborts while the schema is fetched", async () => {
    const { options } = world();
    const controller = new AbortController();
    const fetch: typeof options.fetch = (url, init) => {
      if (url !== SCHEMA_URL) return options.fetch(url, init);
      controller.abort(new Error("stop"));
      return new Promise(() => undefined);
    };
    const jws = await jwsOf(naming(SCHEMA_URL));
    await expect(verifyCredential(jws, { ...options, fetch, signal: controller.signal })).rejects.toThrow("stop");
  });

  it.each([
    [
      "applies many schemas to each item of a long list",
      { properties: { extra: { items: { allOf: Array.from({ length: 1000 }, () => ({ type: "number" })) } } } },
    ],
    ["compares each item of a long list with every other", { properties: { extra: { uniqueItems: true } } }],
    [
      "refers to its definitions ten times at each of ten levels",
      {
        $defs: Object.fromEntries(
          Array.from({ length: 10 }, (_, level) => [
            `l${level}`,
            level === 9
              ? { type: "number" }
              : { allOf: Array.from({ length: 10 }, () => ({ $ref: `#/$defs/l${level + 1}` })) },
          ]),
        ),
        properties: { extra: { items: { $ref: "#/$defs/l0" } } },
      },
    ],
  ])(
    "is unavailable when judging would read more than a verifier gives, as a schema that %s",
    async (_name, schema) => {
      const { options } = world({ [SCHEMA_URL]: schema });
      const credential = { ...naming(SCHEMA_URL), extra: Array.from({ length: 5000 }, (_, index) => index) };
      const result = await verifyCredential(await jwsOf(credential), options);
      expect(outcomes(result).schema).toBe("unavailable");
      expect(detailOf(result, "schema")).toContain("more than 10000000 values");
    },
  );

  it("reads a schema that refers to its own definitions and judges with it", async () => {
    const schema = {
      $defs: { text: { type: "string" } },
      properties: { id: { $ref: "#/$defs/text" } },
      required: ["id"],
    };
    const { options } = world({ [SCHEMA_URL]: schema });
    expect(outcomes(await verifyCredential(await jwsOf(naming(SCHEMA_URL)), options)).schema).toBe("passed");
  });

  it("is unavailable when the credential names more schemas than a verifier fetches, and none is fetched", async () => {
    const addresses = [1, 2, 3, 4, 5].map((at) => `https://example.edu/schemas/${at}.json`);
    const { options, requests } = world(Object.fromEntries(addresses.map((address) => [address, { type: "object" }])));
    const result = await verifyCredential(await jwsOf(naming(...addresses)), options);
    expect(outcomes(result).schema).toBe("unavailable");
    expect(detailOf(result, "schema")).toContain("more than the 4");
    expect(requests.filter((url) => addresses.includes(url))).toStrictEqual([]);
  });

  it("is fetched once for a call, whatever number of credentials name it", async () => {
    const { options, requests } = world({ [SCHEMA_URL]: { type: "object" } });
    const jws = await jwsOf(naming(SCHEMA_URL, SCHEMA_URL));
    await verifyCredential(jws, options);
    expect(requests.filter((url) => url === SCHEMA_URL)).toHaveLength(1);
  });

  it("is not fetched when the proof fails, since the address came from a credential that nothing vouches for", async () => {
    const { options, requests } = world({ [SCHEMA_URL]: { type: "object" } });
    const jws = await jwsOf(naming(SCHEMA_URL), attacker);
    expect(outcomes(await verifyCredential(jws, options)).proof).toBe("failed");
    expect(requests).not.toContain(SCHEMA_URL);
  });
});

describe("the refresh of a credential", () => {
  const service = { id: REFRESH_URL, type: "1EdTechCredentialRefresh" };
  const refreshing = (extra: Record<string, unknown> = {}) => ({ ...badge(), refreshService: service, ...extra });

  it("is skipped when the credential has no refresh service, and when the option is false", async () => {
    const { options, requests } = world();
    expect(outcomes(await verifyCredential(await jwsOf(), options)).refresh).toBe("skipped");
    const refreshing_ = await jwsOf(refreshing());
    const result = await verifyCredential(refreshing_, { ...options, refresh: false });
    expect(outcomes(result).refresh).toBe("skipped");
    expect(requests).not.toContain(REFRESH_URL);
  });

  it("replaces the credential with the one that the service gives, which is verified in its turn", async () => {
    const refreshed = await jwsOf({ ...badge(), name: "Refreshed", validFrom: "2024-06-14T10:00:00Z" });
    const { options } = world({ [REFRESH_URL]: refreshed });
    const result = await verifyCredential(await jwsOf(refreshing()), options);
    expect(outcomes(result).refresh).toBe("passed");
    expect(result.credential).toMatchObject({ name: "Refreshed" });
    expect(result.verified).toBe(true);
  });

  it("goes on with the original when the service does not answer, and unavailable says whether that fails", async () => {
    const { options } = world({ [REFRESH_URL]: 503 });
    const jws = await jwsOf(refreshing({ name: "Original" }));
    const result = await verifyCredential(jws, options);
    expect(outcomes(result)).toMatchObject({ refresh: "unavailable", status: "skipped", validity: "passed" });
    expect(result.credential).toMatchObject({ name: "Original" });
    expect(result.verified).toBe(false);
    expect((await verifyCredential(jws, { ...options, unavailable: "warn" })).verified).toBe(true);
  });

  it("goes on with the original when no fetch was given", async () => {
    const { keys, clock } = world();
    const result = await verifyCredential(await jwsOf(refreshing()), { keys, clock });
    expect(outcomes(result).refresh).toBe("unavailable");
  });

  it("goes on with the original when the answer is no credential", async () => {
    const { options } = world({ [REFRESH_URL]: "not a credential" });
    const result = await verifyCredential(await jwsOf(refreshing()), options);
    expect(outcomes(result).refresh).toBe("unavailable");
  });

  it("goes on with the original when the answer names a hosted 2.0 assertion and holds no credential", async () => {
    const address = "https://example.edu/assertions/1";
    const { options, requests } = world({ [REFRESH_URL]: { kind: "badge-v2", credential: address } });
    const result = await verifyCredential(await jwsOf(refreshing()), options);
    expect(outcomes(result).refresh).toBe("unavailable");
    expect(requests).not.toContain(address);
  });

  it("goes on with the original when the answer is longer than a credential may be", async () => {
    const original = await jwsOf(refreshing());
    const refreshed = await jwsOf({ ...badge(), name: "A refreshed credential with a much longer name".repeat(10) });
    const { options } = world({ [REFRESH_URL]: refreshed });
    const result = await verifyCredential(original, { ...options, maxInputBytes: original.length + 10 });
    expect(outcomes(result).refresh).toBe("unavailable");
    expect(detailOf(result, "refresh")).toContain("characters");
  });

  it("goes on with the original when the refreshed credential is not authentic", async () => {
    const forged = await jwsOf({ ...badge(), name: "Forged" }, attacker);
    const { options } = world({ [REFRESH_URL]: forged });
    const result = await verifyCredential(await jwsOf(refreshing({ name: "Original" })), options);
    expect(outcomes(result).refresh).toBe("unavailable");
    expect(detailOf(result, "refresh")).toContain("not authentic");
    expect(result.credential).toMatchObject({ name: "Original" });
  });

  it("goes on with the original when the key of the refreshed credential cannot be tied to its issuer", async () => {
    const refreshed = await jwsOf({ ...badge(), name: "Refreshed" });
    const { options } = world({ [REFRESH_URL]: refreshed });
    // What the issuer publishes is read for the original and cannot be read for the refreshed credential.
    let reads = 0;
    const keys = {
      resolve: options.keys.resolve,
      issuerKeys: async (issuer: string) => {
        reads += 1;
        if (reads > 1) throw new ServiceError("The keys of the issuer could not be read.", 503, "");
        return await options.keys.issuerKeys(issuer);
      },
    };
    for (const unavailable of ["fail", "warn"] as const) {
      reads = 0;
      const result = await verifyCredential(await jwsOf(refreshing({ name: "Original" })), {
        ...options,
        keys,
        unavailable,
      });
      expect(outcomes(result)).toMatchObject({ issuer: "passed", refresh: "unavailable" });
      expect(detailOf(result, "refresh")).toContain("not authentic");
      expect(result.credential).toMatchObject({ name: "Original" });
    }
  });

  it("goes on with the original when the service gives another credential, which would swap one for another", async () => {
    const other = await jwsOf({ ...badge(), id: "https://example.edu/credentials/2" });
    const { options } = world({ [REFRESH_URL]: other });
    const result = await verifyCredential(await jwsOf(refreshing()), options);
    expect(detailOf(result, "refresh")).toContain("another credential");
    expect(result.credential).toMatchObject({ id: "https://example.edu/credentials/1" });
  });

  it("is followed once, though the refreshed credential names a refresh service itself", async () => {
    const again = { id: "https://example.edu/refresh/2", type: "1EdTechCredentialRefresh" };
    const refreshed = await jwsOf({ ...badge(), name: "Refreshed", refreshService: again });
    const { options, requests } = world({ [REFRESH_URL]: refreshed, [again.id]: refreshed });
    await verifyCredential(await jwsOf(refreshing()), options);
    expect(requests).toContain(REFRESH_URL);
    expect(requests).not.toContain(again.id);
  });

  it("rejects with the reason of a signal that aborts while the service is called", async () => {
    const { options } = world();
    const controller = new AbortController();
    const fetch: typeof options.fetch = (url, init) => {
      if (url !== REFRESH_URL) return options.fetch(url, init);
      controller.abort(new Error("stop"));
      return new Promise(() => undefined);
    };
    const jws = await jwsOf(refreshing());
    await expect(verifyCredential(jws, { ...options, fetch, signal: controller.signal })).rejects.toThrow("stop");
  });

  it("is refused for a refreshed credential that has more endorsements than a credential may, as for the original", async () => {
    const one = await jwsOf(endorsementCredential());
    const refreshed = await jwsOf({ ...badge(), name: "Refreshed", endorsementJwt: [one, one, one] });
    const { options } = world({ [REFRESH_URL]: refreshed });
    const result = await verifyCredential(await jwsOf(refreshing()), { ...options, maxEndorsements: 2 });
    expect(outcomes(result)).toMatchObject({ format: "failed", refresh: "passed" });
    expect(detailOf(result, "format")).toContain("3 endorsements");
    expect(result.credential).toBeUndefined();
  });

  it("is not followed before the proof is valid, so a forger cannot make a verifier call an address", async () => {
    const { options, requests } = world({ [REFRESH_URL]: await jwsOf() });
    const result = await verifyCredential(await jwsOf(refreshing(), attacker), options);
    expect(outcomes(result)).toMatchObject({ proof: "failed", refresh: "skipped" });
    expect(requests).not.toContain(REFRESH_URL);
  });

  it("makes the refreshed credential the one whose validity, status and recipient are judged", async () => {
    const expired = await jwsOf({ ...badge(), validFrom: "2024-06-13T10:00:00Z", validUntil: "2024-06-14T11:00:00Z" });
    const { options } = world({ [REFRESH_URL]: expired });
    const result = await verifyCredential(await jwsOf(refreshing()), options);
    expect(outcomes(result)).toMatchObject({ refresh: "passed", validity: "failed" });
  });
});

describe("the status of a credential", () => {
  const listed = async (list = listWith(), extra = {}) => world({ [LIST_URL]: await listJws(list, extra) });

  it("is skipped when the credential has no status, and passes when its entry is not set", async () => {
    const { options } = await listed();
    expect(outcomes(await verifyCredential(await jwsOf(), options)).status).toBe("skipped");
    const result = await verifyCredential(await jwsOf(credentialWithStatus()), options);
    expect(outcomes(result)).toStrictEqual({ ...ALL_PASSED, status: "passed" });
  });

  it("fails when the entry is set, and the credential is still returned for a displayer to say why", async () => {
    const { options } = await listed(listWith(94_567));
    const result = await verifyCredential(await jwsOf(credentialWithStatus()), options);
    expect(outcomes(result).status).toBe("failed");
    expect(detailOf(result, "status")).toContain("revoked");
    expect(result.verified).toBe(false);
    expect(result.credential).toBeDefined();
  });

  it("is unavailable when the list cannot be fetched, or no fetch was given", async () => {
    const jws = await jwsOf(credentialWithStatus());
    const missing = world();
    const unreachable = await verifyCredential(jws, missing.options);
    expect(outcomes(unreachable).status).toBe("unavailable");
    expect((await verifyCredential(jws, { ...missing.options, unavailable: "warn" })).verified).toBe(true);
    const { keys, clock } = missing;
    expect(outcomes(await verifyCredential(jws, { keys, clock })).status).toBe("unavailable");
  });

  it("fails for a list that the issuer did not sign, and for one that another issuer published", async () => {
    const jws = await jwsOf(credentialWithStatus());
    const forged = world({ [LIST_URL]: await listJws(listWith(), {}, attacker) });
    expect(detailOf(await verifyCredential(jws, forged.options), "status")).toContain("STATUS_VERIFICATION_ERROR");
    const foreign = "https://other.example/issuers/9";
    const otherDocument = {
      id: foreign,
      verificationMethod: [
        { id: `${foreign}#k`, type: "JsonWebKey", controller: foreign, publicKeyJwk: KEYS.other.publicJwk },
      ],
      assertionMethod: [`${foreign}#k`],
    };
    const list = await listJws(listWith(), { issuer: foreign }, signerOf(KEYS.other, `${foreign}#k`));
    const shared = world({ [LIST_URL]: list, [foreign]: otherDocument });
    const refused = await verifyCredential(jws, shared.options);
    expect(outcomes(refused).status).toBe("failed");
    expect(detailOf(refused, "status")).toContain("not by");
    const allowed = await verifyCredential(jws, { ...shared.options, statusIssuers: [foreign] });
    expect(outcomes(allowed).status).toBe("passed");
  });

  it("is read from a list whose key the issuer does not publish only when allowUnboundKeys says so", async () => {
    const other = `${ISSUER}#other`;
    const document = {
      id: ISSUER,
      verificationMethod: [
        { id: `${ISSUER}#key-1`, type: "JsonWebKey", controller: ISSUER, publicKeyJwk: KEYS.es256.publicJwk },
        { id: other, type: "JsonWebKey", controller: ISSUER, publicKeyJwk: KEYS.other.publicJwk },
      ],
      assertionMethod: [`${ISSUER}#key-1`],
      authentication: [other],
    };
    const list = await listJws(listWith(), {}, signerOf(KEYS.other, other));
    const { options } = world({ [ISSUER]: document, [LIST_URL]: list });
    const jws = await jwsOf(credentialWithStatus());
    expect(outcomes(await verifyCredential(jws, options)).status).toBe("failed");
    const accepted = await verifyCredential(jws, { ...options, allowUnboundKeys: true });
    expect(outcomes(accepted).status).toBe("passed");
  });

  it("is read from a list that the host's cache keeps across calls, and from one fetch for a call without a cache", async () => {
    const { options, requests, clock } = await listed();
    const jws = await jwsOf(credentialWithStatus());
    const statusLists = createStatusListCache({ clock });
    await verifyCredential(jws, { ...options, statusLists });
    await verifyCredential(jws, { ...options, statusLists });
    expect(requests.filter((url) => url === LIST_URL)).toHaveLength(1);
    await verifyCredential(jws, options);
    expect(requests.filter((url) => url === LIST_URL)).toHaveLength(2);
  });

  it("is judged with the clock of the options, which expires a list at its validUntil", async () => {
    const { options } = await listed(listWith(), { validUntil: "2024-06-14T11:00:00Z" });
    const result = await verifyCredential(await jwsOf(credentialWithStatus()), options);
    expect(outcomes(result).status).toBe("failed");
  });
});

describe("the recipient of a credential", () => {
  const SALT = "pepper";
  const email = "learner@example.edu";
  const subject = {
    id: "did:example:learner",
    type: ["AchievementSubject"],
    identifier: [
      {
        type: "IdentityObject",
        hashed: true,
        identityHash: hashIdentifier(email, SALT),
        identityType: "emailAddress",
        salt: SALT,
      },
      { type: "IdentityObject", hashed: false, identityHash: "learner42", identityType: "userName" },
    ],
    achievement: (achievementCredential().credentialSubject as { achievement: unknown }).achievement,
  };
  const credentialOf = () => ({ ...achievementCredential(), credentialSubject: subject });

  it("is skipped when none is known", async () => {
    const { options } = world();
    expect(outcomes(await verifyCredential(await jwsOf(credentialOf()), options)).recipient).toBe("skipped");
  });

  it.each([
    ["the id of the subject", { id: "did:example:learner" }, "passed"],
    ["another id", { id: "did:example:other" }, "failed"],
    ["a hashed identifier", { identifier: { type: "emailAddress", value: email } }, "passed"],
    ["a plain identifier", { identifier: { type: "userName", value: "learner42" } }, "passed"],
    [
      "the wrong value of a hashed identifier",
      { identifier: { type: "emailAddress", value: "x@example.edu" } },
      "failed",
    ],
    ["the right value of another type", { identifier: { type: "userName", value: email } }, "failed"],
    [
      "an id that does not match and an identifier that does",
      { id: "did:example:other", identifier: { type: "emailAddress", value: email } },
      "passed",
    ],
  ])("is checked against %s", async (_name, recipient, outcome) => {
    const { options } = world();
    const result = await verifyCredential(await jwsOf(credentialOf()), { ...options, recipient });
    expect(outcomes(result).recipient).toBe(outcome);
    expect(result.verified).toBe(outcome === "passed");
  });
});

describe("the period of a credential", () => {
  it("is refused by the reader as a failure of the format when its start or its end is no date and time", async () => {
    const { options } = world();
    for (const change of [
      { validFrom: "tomorrow" },
      { validUntil: "2030-01-01" },
      { validFrom: "2024-06-13T10:00:00" },
    ]) {
      const result = await verifyCredential(
        await forge({ ...achievementCredential(), ...change, iss: ISSUER }, KEYS.es256),
        options,
      );
      expect(outcomes(result).format).toBe("failed");
      expect(detailOf(result, "format")).toContain(Object.keys(change)[0]);
      expect(result.verified).toBe(false);
    }
  });

  it("is refused by the reader as a failure of the format when a credential states no start", async () => {
    const { options } = world();
    const { validFrom: _start, ...unbounded } = achievementCredential();
    const result = await verifyCredential(await forge({ ...unbounded, iss: ISSUER }, KEYS.es256), options);
    expect(outcomes(result).format).toBe("failed");
    expect(detailOf(result, "format")).toContain("validFrom");
  });
});

describe("the subject of a credential that several subjects would make", () => {
  it("is refused by the reader as a failure of the format, so that no check reads a subject that is not one object", async () => {
    const { options } = world();
    const subject = { ...(achievementCredential().credentialSubject as object), id: "did:example:learner" };
    const clr = { ...clrCredential(), credentialSubject: [clrCredential().credentialSubject] };
    for (const credential of [{ ...achievementCredential(), credentialSubject: [subject] }, clr]) {
      const result = await verifyCredential(await forge({ ...credential, iss: ISSUER }, KEYS.es256), {
        ...options,
        recipient: { id: "did:example:learner" },
      });
      expect(outcomes(result).format).toBe("failed");
      expect(detailOf(result, "format")).toContain("credentialSubject");
      expect(result.verified).toBe(false);
    }
  });
});

describe("what unavailable governs", () => {
  it("never makes a failed check pass, and a warn never accepts a proof that could not be checked", async () => {
    const { options } = world();
    const revoked = world({ [LIST_URL]: await listJws(listWith(94_567)) });
    const result = await verifyCredential(await jwsOf(credentialWithStatus()), {
      ...revoked.options,
      unavailable: "warn",
    });
    expect(result.verified).toBe(false);
    const forged = await verifyCredential(await jwsOf(badge(), attacker), { ...options, unavailable: "warn" });
    expect(forged.verified).toBe(false);
  });

  it("is judged on the checks of the whole result, so one unavailable check among passed ones is enough", async () => {
    const clock = clockAt(NOW);
    const { options } = world();
    const jws = await jwsOf(credentialWithStatus());
    const result = await verifyCredential(jws, {
      ...options,
      keys: createKeyResolver({ clock, fetch: options.fetch }),
    });
    expect(result.checks.filter(({ outcome }) => outcome === "unavailable").map(({ check }) => check)).toStrictEqual([
      "status",
    ]);
    expect(result.verified).toBe(false);
  });
});

void signer;

describe("the schemas of 1EdTech that need no fetch", () => {
  it("are the schemas of credentials that the schema lock pins, none more and none fewer", () => {
    const lock: readonly { readonly url?: string }[] = JSON.parse(
      readFileSync(new URL("../../../scripts/schemas.lock.json", import.meta.url), "utf8"),
    );
    const pinned = lock
      .map(({ url }) => url ?? "")
      .filter((url) => /\/schema\/json\/(?:ob_v3p0|clr_v2p0)_[a-z]*credential_schema\.json$/u.test(url));
    expect([...OFFICIAL_SCHEMA_IDS].sort()).toStrictEqual(pinned.sort());
  });

  it("are not fetched, whichever of them a credential names", async () => {
    const { options, requests } = world();
    const result = await verifyCredential(await jwsOf(naming(...OFFICIAL_SCHEMA_IDS)), options);
    expect(outcomes(result).schema).toBe("passed");
    expect(requests.filter((url) => url.includes("/schema/json/"))).toStrictEqual([]);
  });
});
