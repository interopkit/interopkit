// cspell:ignore achievementcredential clrcredential getopenbadgecredentialsresponse getclrcredentialsresponse
import { resolve } from "node:path";
import type { Schema } from "@cfworker/json-schema";
import type { HttpResponse } from "@interopkit/core/http";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readSchema, schemaValidator } from "../../../scripts/schema-oracle.js";
import { type CredentialApi, validateCredential } from "../src/index.js";
import { type CredentialsProviderOptions, handleCredentialsRequest } from "../src/provider/index.js";
import { achievementCredential, clrCredential, PROFILE } from "./fixtures.js";
import { fileSchema, oracleOf } from "./official.js";
import { type Asked, bearerAuthorize, description, ROOTS, request, serving } from "./provider-fixture.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const APIS = ["badges", "clr"] as const;
/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_261_102, numRuns: 30 };
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

/** An operation of an OpenAPI file, as the tests read it. */
interface FileOperation {
  readonly operationId: string;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly parameters?: readonly {
    readonly name: string;
    readonly in: string;
    readonly schema: Record<string, unknown>;
  }[];
  readonly requestBody?: { readonly content: Readonly<Record<string, unknown>> };
  readonly responses: Readonly<
    Record<string, { readonly content?: Readonly<Record<string, { readonly schema: unknown }>> }>
  >;
}

/** The parts of the OpenAPI file of an API that the tests read. */
interface OpenApiFile {
  readonly paths: Readonly<Record<string, Readonly<Record<string, FileOperation>>>>;
  readonly components: {
    readonly schemas: Readonly<Record<string, unknown>>;
    readonly securitySchemes: {
      readonly OAuth2ACG: {
        readonly flows: { readonly authorizationCode: { readonly scopes: Record<string, string> } };
      };
    };
  };
}

const FILES: Readonly<Record<CredentialApi, OpenApiFile>> = {
  badges: readSchema(ROOT, "ob_v3p0_oas.json") as unknown as OpenApiFile,
  clr: readSchema(ROOT, "clr_v2p0_oas.json") as unknown as OpenApiFile,
};

/** The operations of a file: its paths with each method that it serves, in upper case. */
function operationsOf(
  api: CredentialApi,
): { readonly path: string; readonly method: string; readonly operation: FileOperation }[] {
  return Object.entries(FILES[api].paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method: method.toUpperCase(), operation })),
  );
}

/** Whether a `oneOf` of a schema is the one that the files give each member of `@context`: two schemas of a string. */
function isStringTwice(branches: unknown): boolean {
  return Array.isArray(branches) && branches.length === 2 && branches.every((branch) => branch?.type === "string");
}

/**
 * Repairs the schema of a member of `@context`: the files give it a `oneOf` of two schemas of a string, the second meant as a
 * map, so a string matches both and no context is valid. It becomes the `anyOf` of the two.
 */
function repaired(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(repaired);
  if (typeof node !== "object" || node === null) return node;
  const entries = Object.entries(node).map(([name, value]) => [name, repaired(value)] as const);
  const object = Object.fromEntries(entries) as Record<string, unknown>;
  if (!isStringTwice(object.oneOf)) return object;
  const { oneOf, ...rest } = object;
  return { ...rest, anyOf: oneOf };
}

/** A schema of the file with the schemas it refers to, which the validator reads as `definitions`. */
function definitionsOf(api: CredentialApi, schema: unknown): Schema {
  const text = JSON.stringify({ ...(schema as object), definitions: FILES[api].components.schemas });
  return JSON.parse(text.replaceAll("#/components/schemas/", "#/definitions/")) as Schema;
}

/** The validator of a schema of the file, with the schema of a member of `@context` repaired. */
function validatorOf(api: CredentialApi, schema: unknown): (value: unknown) => boolean {
  return schemaValidator(repaired(definitionsOf(api, schema)) as Schema, "7");
}

/** The credential of an API that the fixtures hold. */
const credentialOf = (api: CredentialApi) => (api === "badges" ? achievementCredential() : clrCredential());

/** Writes a value as the base64url of its JSON. */
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * The credential of an API as a compact JWS whose signature no one checks: a CLR in a JWT holds its credentials as compact JWS
 * (CLR 7.2.4.1).
 */
function signedOf(api: CredentialApi, change: Record<string, unknown> = {}): string {
  const jws = (payload: unknown) => `${encoded({ alg: "ES256" })}.${encoded(payload)}.c2ln`;
  if (api === "badges") return jws({ ...achievementCredential(), ...change });
  const clr = clrCredential();
  const subject = { ...(clr.credentialSubject as object), verifiableCredential: [jws(achievementCredential())] };
  return jws({ ...clr, credentialSubject: subject, ...change });
}

/** A request with a body that the operation takes, so that the answer is the operation's and not a refusal of the body. */
function requestFor(api: CredentialApi, path: string, method: string, token: string | null = "token-all") {
  const url = `${ROOTS[api]}${path}`;
  if (method === "POST")
    return request(method, url, { body: JSON.stringify(credentialOf(api)), type: "application/json", token });
  if (method === "PUT") return request(method, url, { body: JSON.stringify(PROFILE), type: "application/json", token });
  return request(method, url, { token });
}

/** Checks that the file lists the status of an answer, or a default, and that the schema of its media type accepts the body. */
function expectListed(api: CredentialApi, operation: FileOperation, response: HttpResponse): void {
  const listed = operation.responses[String(response.status)] ?? operation.responses.default;
  expect(listed, `${operation.operationId} ${response.status}`).toBeDefined();
  if (response.body === "") return;
  const type = response.headers["content-type"]?.split(";")[0] ?? "";
  const content = listed?.content?.[type];
  expect(content, `${operation.operationId} ${response.status} ${type}`).toBeDefined();
  const body = type === "text/plain" ? String(response.body) : JSON.parse(String(response.body));
  expect(validatorOf(api, content?.schema)(body), `${operation.operationId} ${response.status}`).toBe(true);
}

describe.each(APIS)("the provider of the %s API against its OpenAPI file", (api) => {
  const file = FILES[api];
  const kind = api === "badges" ? "AchievementCredential" : "ClrCredential";

  it("validates no credential with the file's schema of a member of @context, which the tests repair", () => {
    const schema = { $ref: `#/components/schemas/${kind}` };
    expect(schemaValidator(definitionsOf(api, schema), "7")(credentialOf(api))).toBe(false);
    expect(validatorOf(api, schema)(credentialOf(api))).toBe(true);
  });

  it("serves the paths and methods of the file, and answers 405 with the file's methods in Allow for any other", async () => {
    const { options } = serving(api);
    for (const [path, methods] of Object.entries(file.paths)) {
      const served = Object.keys(methods).map((method) => method.toUpperCase());
      for (const method of METHODS) {
        const response = await handleCredentialsRequest(requestFor(api, path, method), options);
        if (served.includes(method)) {
          expect(
            [404, 405].includes(response.status) && response.headers.allow !== undefined,
            `${method} ${path}`,
          ).toBe(false);
        } else {
          expect(response.status, `${method} ${path}`).toBe(405);
          expect(response.headers.allow?.split(", ").sort()).toStrictEqual(served.sort());
        }
      }
    }
  });

  it("asks authorize for the scope that the security of each operation names, and nothing for an operation without one", async () => {
    for (const { path, method, operation } of operationsOf(api)) {
      const asked: Asked[] = [];
      const { options } = serving(api, { authorize: bearerAuthorize(asked) });
      await handleCredentialsRequest(requestFor(api, path, method), options);
      const scopes = (operation.security ?? []).flatMap((requirement) => requirement.OAuth2ACG ?? []);
      expect(
        asked.map(({ argument }) => argument),
        operation.operationId,
      ).toStrictEqual(scopes);
    }
  });

  it("refuses a request whose token lacks the scope, for every operation that has one", async () => {
    for (const { path, method, operation } of operationsOf(api)) {
      const scopes = (operation.security ?? []).flatMap((requirement) => requirement.OAuth2ACG ?? []);
      if (scopes.length === 0) continue;
      const { options, held } = serving(api, {
        authorize: async (_request, scope) =>
          scopes.includes(scope) ? { allowed: false, reason: "forbidden" } : { allowed: true, owner: "learner-1" },
      });
      const response = await handleCredentialsRequest(requestFor(api, path, method), options);
      expect(response.status, operation.operationId).toBe(403);
      expect(held.credentials.size + held.profiles.size).toBe(0);
    }
  });

  it("needs a service description that offers every scope of the file's security scheme", async () => {
    const offered = Object.keys(file.components.securitySchemes.OAuth2ACG.flows.authorizationCode.scopes);
    const discovery = (scopes: readonly string[]) => {
      const document = description(api);
      Object.assign(
        (
          document.components as {
            securitySchemes: { OAuth2ACG: { flows: { authorizationCode: Record<string, unknown> } } };
          }
        ).securitySchemes.OAuth2ACG.flows.authorizationCode,
        { scopes: Object.fromEntries(scopes.map((scope) => [scope, "..."])) },
      );
      const options: CredentialsProviderOptions = { ...serving(api).options, serviceDescription: document as never };
      return handleCredentialsRequest(request("GET", `${ROOTS[api]}/discovery`, { token: null }), options);
    };
    expect((await discovery(offered)).status).toBe(200);
    for (const scope of offered) {
      await expect(discovery(offered.filter((each) => each !== scope)), scope).rejects.toThrow(scope);
    }
  });

  it("reads the query parameters of getCredentials with the minimums and the formats that the file gives them", async () => {
    const list = operationsOf(api).find(({ operation }) => operation.operationId === "getCredentials");
    const parameters = list?.operation.parameters ?? [];
    expect(parameters.map(({ name }) => name).sort()).toStrictEqual(["limit", "offset", "since"]);
    const { options } = serving(api);
    const get = (query: string) =>
      handleCredentialsRequest(request("GET", `${ROOTS[api]}/credentials?${query}`), options);
    for (const { name, schema } of parameters) {
      if (typeof schema.minimum === "number") {
        expect((await get(`${name}=${schema.minimum}`)).status, name).toBe(200);
        expect((await get(`${name}=${schema.minimum - 1}`)).status, name).toBe(400);
      }
      if (schema.format === "date-time") {
        expect((await get(`${name}=2024-06-13T18%3A46%3A03Z`)).status, name).toBe(200);
        expect((await get(`${name}=13%20June%202024`)).status, name).toBe(400);
      }
    }
  });

  it("takes every media type that the file lists for a request body", async () => {
    for (const { path, method, operation } of operationsOf(api)) {
      for (const type of Object.keys(operation.requestBody?.content ?? {})) {
        const body =
          method === "PUT"
            ? JSON.stringify(PROFILE)
            : type === "text/plain"
              ? signedOf(api)
              : JSON.stringify(credentialOf(api));
        const response = await handleCredentialsRequest(
          request(method, `${ROOTS[api]}${path}`, { body, type }),
          serving(api).options,
        );
        expect(response.status, `${operation.operationId} ${type}`).not.toBe(415);
        expect(response.status, `${operation.operationId} ${type}`).toBeLessThan(300);
      }
    }
  });

  it("answers each operation with a status that the file lists, and a body that its schema for the status accepts", async () => {
    const operations = new Map(operationsOf(api).map((each) => [each.operation.operationId, each]));
    const { options, held } = serving(api);
    const send = async (id: string, init: Parameters<typeof request>[2] = {}, query = "") => {
      const found = operations.get(id);
      if (found === undefined) throw new Error(`The file has no operation ${id}.`);
      const response = await handleCredentialsRequest(
        request(found.method, `${ROOTS[api]}${found.path}${query}`, init),
        options,
      );
      expectListed(api, found.operation, response);
      return response;
    };
    const credential = JSON.stringify(credentialOf(api));
    expect((await send("getProfile")).status).toBe(404);
    expect((await send("upsertCredential", { body: credential, type: "application/json" })).status).toBe(201);
    expect((await send("upsertCredential", { body: credential, type: "application/json" })).status).toBe(304);
    const newer = JSON.stringify({ ...credentialOf(api), validFrom: "2025-01-01T00:00:00Z" });
    expect((await send("upsertCredential", { body: newer, type: "application/json" })).status).toBe(200);
    const signed = signedOf(api, { id: "https://example.edu/credentials/2" });
    expect((await send("upsertCredential", { body: signed, type: "text/plain" })).status).toBe(201);
    expect((await send("getCredentials")).status).toBe(200);
    expect((await send("putProfile", { body: JSON.stringify(PROFILE), type: "application/json" })).status).toBe(200);
    expect((await send("getProfile")).status).toBe(200);
    expect((await send("getServiceDescription", { token: null })).status).toBe(200);
    expect((await send("getCredentials", {}, "?limit=0")).status).toBe(400);
    expect((await send("getCredentials", { token: null })).status).toBe(401);
    expect((await send("getProfile", { token: "token-read" })).status).toBe(403);
    expect((await send("upsertCredential", { body: "[]", type: "application/json" })).status).toBe(422);
    expect(held.credentials.get("learner-1")).toHaveLength(2);
  });
});

describe.each([
  {
    api: "badges" as const,
    credential: "ob_v3p0_achievementcredential_schema.json",
    answer: "ob_v3p0_getopenbadgecredentialsresponse_schema.json",
  },
  {
    api: "clr" as const,
    credential: "clr_v2p0_clrcredential_schema.json",
    answer: "clr_v2p0_getclrcredentialsresponse_schema.json",
  },
])("the credentials of the $api API that the official schema generates", ({ api, credential, answer }) => {
  const generated = oracleOf(fileSchema(credential));
  const listed = oracleOf(fileSchema(answer));
  const kind = api === "badges" ? "AchievementCredential" : "ClrCredential";
  // The readers add rules that the schemas do not state, and the provider takes only the credential of its API.
  const readable = generated.arbitrary.filter((value) =>
    validateCredential(value, { kind }).every(({ severity }) => severity !== "error"),
  );

  it("are stored as they came and listed in an answer that the schema of the answer accepts", async () => {
    let stored = 0;
    await fc.assert(
      fc.asyncProperty(readable, async (value) => {
        const { options, held } = serving(api);
        const body = JSON.stringify(value);
        const answer = await handleCredentialsRequest(
          request("POST", `${ROOTS[api]}/credentials`, { body, type: "application/json" }),
          options,
        );
        if (answer.status === 422) {
          // A generated type may name another kind besides the API's: the provider refuses it, and stores nothing.
          expect(held.credentials.size).toBe(0);
          return;
        }
        expect(answer.status).toBe(201);
        expect(answer.body).toBe(body);
        stored += 1;
        const list = await handleCredentialsRequest(request("GET", `${ROOTS[api]}/credentials`), options);
        const page = JSON.parse(String(list.body));
        expect(page.credential).toStrictEqual([JSON.parse(body)]);
        expect(listed.valid(page)).toBe(true);
      }),
      RUNS,
    );
    expect(stored).toBeGreaterThan(RUNS.numRuns / 2);
  });
});
