import { DataError, signerFromCryptoKey } from "@interopkit/core";
import { beforeAll, describe, expect, it } from "vitest";
import { attachmentHash, writeMultipart } from "../src/attachments/index.js";
import { type AttachmentData, buildStatement, type Statement } from "../src/index.js";
import { SIGNATURE_USAGE_TYPE, signStatement, verifyStatementSignature } from "../src/signing/index.js";
import { handleLrsRequest } from "../src/store/index.js";
import { fakeLrs } from "./fake-lrs.js";
import { minimalStatement, providerStatementV1, uuid } from "./full-statement.js";
import { CONSISTENT_THROUGH, clientOf, collect, statementOf } from "./lrs-client.js";
import { memory, optionsOf, reasonOf, requestOf } from "./memory-lrs.js";

const PROCTOR = { objectType: "contextAgent", agent: { mbox: "mailto:proctor@example.org" } } as const;
const VERSION = "x-experience-api-version";

/** A Statement of 1.0.3 that a provider may send. */
function statementV1(n: number): Statement {
  return buildStatement(
    {
      id: uuid(n),
      actor: { mbox: "mailto:learner@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
      object: { id: "https://example.org/activities/course-1" },
      timestamp: "2024-06-13T18:46:03.250Z",
    },
    { version: "1.0.3" },
  );
}

/** A Statement as an LRS that serves 2.0 holds it, with what 1.0.3 does not have. */
function heldOfV2(n: number): Statement {
  return {
    ...statementOf(n),
    context: { language: "en", contextAgents: [PROCTOR] },
    stored: "2024-06-13T18:46:04.100000000Z",
    version: "2.0.0",
  };
}

const JSON_TYPE = { "content-type": "application/json" };

/**
 * Writes the multipart message of a Statement and the data of one Attachment by hand: `writeMultipart` reads the Statement as
 * RFC 3339 asks, and this one is in another form of ISO 8601, as a provider outside this package may send it.
 */
function writeMultipartRaw(statement: Statement, part: AttachmentData) {
  const boundary = "boundary-of-the-test";
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(statement)}\r\n--${boundary}\r\nContent-Type: ${part.contentType}\r\nContent-Transfer-Encoding: binary\r\nX-Experience-API-Hash: ${part.sha2}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.byteLength + part.body.byteLength + tail.byteLength);
  body.set(head);
  body.set(part.body, head.byteLength);
  body.set(tail, head.byteLength + part.body.byteLength);
  return { contentType: `multipart/mixed; boundary=${boundary}`, body };
}

describe("a client of 1.0.3", () => {
  it("names 1.0.3 in the version header of every request", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const client = clientOf(lrs, { version: "1.0.3" });
    await client.sendStatement(statementV1(1));
    expect(lrs.requests.map(({ init }) => new Headers(init?.headers).get(VERSION))).toStrictEqual(["1.0.3"]);
  });

  it("sends a Statement built for 1.0.3, and the client of 2.0 does not", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    expect(await clientOf(lrs, { version: "1.0.3" }).sendStatement(statementV1(2))).toBe("stored");
    await expect(clientOf(lrs).sendStatement(statementV1(2))).rejects.toThrow('expected "2.0.0", found "1.0.0"');
    expect(lrs.requests).toHaveLength(1);
  });

  it.each([
    ["contextAgents", { ...statementOf(3), context: { contextAgents: [PROCTOR] } }],
    ["the version 2.0.0", { ...statementOf(3), version: "2.0.0" }],
    ["the basic format of ISO 8601", { ...statementOf(3), timestamp: "20240613T184603Z" }],
  ])("refuses %s before any request", async (_name, statement) => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const client = clientOf(lrs, { version: "1.0.3" });
    await expect(client.sendStatement(statement)).rejects.toBeInstanceOf(DataError);
    await expect(client.sendStatements([statement])).rejects.toBeInstanceOf(DataError);
    expect(lrs.requests).toHaveLength(0);
  });

  it("sends a batch with the Attachments that a provider of 1.0.3 writes", async () => {
    const body = new TextEncoder().encode("a certificate");
    const sha2 = attachmentHash(body);
    const statement: Statement = {
      ...statementV1(4),
      attachments: [
        {
          usageType: "https://example.org/attachments/certificate",
          display: { "en-US": "Certificate" },
          contentType: "text/plain",
          length: body.byteLength,
          sha2,
        },
      ],
    };
    const lrs = fakeLrs(() => ({ status: 200, body: JSON.stringify([uuid(4)]), headers: JSON_TYPE }));
    const client = clientOf(lrs, { version: "1.0.3" });
    expect(
      await client.sendStatements([statement], { attachments: [{ sha2, contentType: "text/plain", body }] }),
    ).toStrictEqual([uuid(4)]);
  });

  it("reads an answer of 2.0 into the form of 1.0.3, and ignores what 1.0.0 does not define", async () => {
    const lrs = fakeLrs(() => ({ body: JSON.stringify(heldOfV2(5)), headers: JSON_TYPE }));
    const found = await clientOf(lrs, { version: "1.0.3" }).getStatement(uuid(5));
    expect(found).toMatchObject({ version: "1.0.0", context: { language: "en" } });
    expect(found).not.toHaveProperty("context.contextAgents");
  });

  it("reads a page of 2.0 into the form of 1.0.3", async () => {
    const lrs = fakeLrs(() => ({
      body: JSON.stringify({ statements: [heldOfV2(6)] }),
      headers: { ...JSON_TYPE, "x-experience-api-consistent-through": CONSISTENT_THROUGH },
    }));
    const [page] = await collect(clientOf(lrs, { version: "1.0.3" }).queryStatements({}));
    expect(page?.statements[0]).toMatchObject({ version: "1.0.0", context: { language: "en" } });
    expect(page?.statements[0]).not.toHaveProperty("context.contextAgents");
  });

  it("reads a Statement of an LRS of 1.0.3 whose times have a form that RFC 3339 does not", async () => {
    const statement = { ...statementV1(7), timestamp: "20240613T184603+0200" };
    const lrs = fakeLrs(() => ({ body: JSON.stringify(statement), headers: JSON_TYPE }));
    expect(await clientOf(lrs, { version: "1.0.3" }).getStatement(uuid(7))).toStrictEqual(statement);
  });

  it("says that an answer is not valid xAPI when it is a Statement of neither version", async () => {
    const lrs = fakeLrs(() => ({ body: JSON.stringify({ ...minimalStatement(), actor: 5 }), headers: JSON_TYPE }));
    await expect(clientOf(lrs, { version: "1.0.3" }).getStatement(uuid(8))).rejects.toThrow("not valid xAPI");
  });
});

describe("the client against the LRS of this package on the route of 1.0.3", () => {
  /** A client whose `fetch` answers with the handler over a memory. */
  function clientOfMemory(version: "2.0.0" | "1.0.3", store = memory()) {
    const lrs = fakeLrs(async (url, { init }) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value;
      });
      const body = init?.body;
      const answer = await handleLrsRequest(
        {
          method: init?.method ?? "GET",
          url: url.href,
          headers,
          body: typeof body === "string" ? new TextEncoder().encode(body) : (body ?? new Uint8Array()),
        },
        optionsOf(store),
      );
      return { status: answer.status, headers: answer.headers, body: answer.status === 204 ? undefined : answer.body };
    });
    return clientOf(lrs, { version });
  }

  it("writes State twice with no precondition, sends and reads a Statement, and the client of 2.0 reads it too", async () => {
    const store = memory();
    const legacy = clientOfMemory("1.0.3", store);
    const target = {
      resource: "state",
      activityId: "https://example.org/activities/course-1",
      agent: { mbox: "mailto:learner@example.org" },
      stateId: "bookmark",
    } as const;
    const document = { contentType: "text/plain", body: new TextEncoder().encode("one") };
    expect(await legacy.putDocument(target, document)).toBe("written");
    expect(await legacy.putDocument(target, document)).toBe("written");
    expect(await legacy.sendStatement(statementV1(9))).toBe("stored");
    expect((await legacy.getStatement(uuid(9)))?.version).toBe("1.0.0");
    expect((await clientOfMemory("2.0.0", store).getStatement(uuid(9)))?.version).toBe("1.0.0");
  });
});

describe("a signature on the route of 1.0.3", () => {
  let pair: CryptoKeyPair;

  beforeAll(async () => {
    pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  });

  /** A signer of the tests. */
  const signer = () => signerFromCryptoKey(pair.privateKey, { algorithm: "RS256" });

  /** A Statement of 2.0 with `contextAgents`, signed. */
  async function signedOfV2() {
    const statement = buildStatement({
      id: uuid(10),
      actor: { mbox: "mailto:learner@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
      object: { id: "https://example.org/activities/course-1" },
      context: { language: "en", contextAgents: [PROCTOR] },
      timestamp: "2024-06-13T18:46:03.250Z",
    });
    return signStatement(statement, signer());
  }

  it("signs a Statement of 1.0.3 by the provider rules of the option, and the signature verifies on that route", async () => {
    const statement = statementV1(11);
    await expect(signStatement(statement, signer())).rejects.toThrow('expected "2.0.0", found "1.0.0"');
    const signed = await signStatement(statement, signer(), { version: "1.0.3" });
    expect(
      await verifyStatementSignature(signed.statement, signed.signature.body, {
        key: pair.publicKey,
        version: "1.0.3",
      }),
    ).toStrictEqual({ valid: true, certified: false });
  });

  it("verifies a Statement of 2.0 in the form of 1.0.3 against the whole payload, only with the version of the route", async () => {
    const signed = await signedOfV2();
    const { context: _context, ...rest } = signed.statement;
    const form = { ...rest, context: { language: "en" }, version: "1.0.0" };
    const key = pair.publicKey;
    expect(await verifyStatementSignature(form, signed.signature.body, { key, version: "1.0.3" })).toStrictEqual({
      valid: true,
      certified: false,
    });
    expect(await verifyStatementSignature(form, signed.signature.body, { key })).toStrictEqual({
      valid: false,
      reason: "not-equivalent",
    });
  });

  it("finds another Statement than the one signed on that route too", async () => {
    const signed = await signedOfV2();
    const changed = { ...signed.statement, context: { language: "id" }, version: "1.0.0" };
    expect(
      await verifyStatementSignature(changed, signed.signature.body, { key: pair.publicKey, version: "1.0.3" }),
    ).toStrictEqual({ valid: false, reason: "not-equivalent" });
  });

  it("judges a signature without a key on that route by the same form", async () => {
    const signed = await signedOfV2();
    const { context: _context, ...rest } = signed.statement;
    const form = { ...rest, context: { language: "en" }, version: "1.0.0" };
    expect(await verifyStatementSignature(form, signed.signature.body, { version: "1.0.3" })).toStrictEqual({
      valid: false,
      reason: "no-key",
    });
  });

  /** Signs a Statement as a provider outside this package may, whatever the rules of a provider say of it: a compact JWS. */
  async function jwsOf(statement: Statement): Promise<Uint8Array<ArrayBuffer>> {
    const encoder = new TextEncoder();
    const encode = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/u, "");
    const data = `${encode(encoder.encode('{"alg":"RS256"}'))}.${encode(encoder.encode(JSON.stringify(statement)))}`;
    const mark = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, encoder.encode(data));
    return encoder.encode(`${data}.${encode(new Uint8Array(mark))}`);
  }

  it("reads a payload of 1.0.3 whose time is in a form of ISO 8601 that RFC 3339 does not have", async () => {
    const statement = { ...providerStatementV1(), attachments: [], timestamp: "20240613T184603+0200" };
    const jws = await jwsOf(statement);
    expect(await verifyStatementSignature(statement, jws, { key: pair.publicKey, version: "1.0.3" })).toStrictEqual({
      valid: true,
      certified: false,
    });
  });

  it("lets the LRS take on that route a signed Statement whose time is in such a form, and writes the time in UTC", async () => {
    const statement = { ...statementV1(15), version: "1.0.3", timestamp: "20240613T204603+0200" };
    const jws = await jwsOf(statement);
    const sha2 = attachmentHash(jws);
    const signed: Statement = {
      ...statement,
      attachments: [
        {
          usageType: SIGNATURE_USAGE_TYPE,
          display: { "en-US": "Signature" },
          contentType: "application/octet-stream",
          length: jws.byteLength,
          sha2,
        },
      ],
    };
    const message = writeMultipartRaw(signed, { sha2, contentType: "application/octet-stream", body: jws });
    const store = memory();
    const taken = await handleLrsRequest(
      requestOf("PUT", "/statements", {
        query: { statementId: uuid(15) },
        headers: { "content-type": message.contentType, [VERSION]: "1.0.3" },
        body: message.body,
      }),
      optionsOf(store),
    );
    expect(taken.status).toBe(204);
    expect(store.held.get(uuid(15))?.statement.timestamp).toBe("2024-06-13T18:46:03.000Z");
  });

  it("refuses the version option that is not one", async () => {
    const signed = await signedOfV2();
    await expect(
      verifyStatementSignature(signed.statement, signed.signature.body, JSON.parse('{"version":"1.0"}')),
    ).rejects.toThrow('The options object is invalid at version: expected "2.0.0" or "1.0.3", found "1.0".');
    await expect(signStatement(statementV1(12), signer(), JSON.parse('{"version":null}'))).rejects.toThrow(
      'The options object is invalid at version: expected "2.0.0" or "1.0.3", found null.',
    );
  });

  it("lets the LRS take a Statement of 1.0.3 signed for that route, and refuses it for another Statement", async () => {
    const signed = await signStatement(statementV1(13), signer(), { version: "1.0.3" });
    const headers = (contentType: string) => ({ "content-type": contentType, [VERSION]: "1.0.3" });
    const store = memory();
    const good = writeMultipart(signed.statement, [signed.signature]);
    const taken = await handleLrsRequest(
      requestOf("PUT", "/statements", {
        query: { statementId: uuid(13) },
        headers: headers(good.contentType),
        body: good.body,
      }),
      optionsOf(store),
    );
    expect(taken.status).toBe(204);
    const other = writeMultipart(
      { ...signed.statement, id: uuid(14), verb: { id: "http://adlnet.gov/expapi/verbs/failed" } },
      [signed.signature],
    );
    const refused = await handleLrsRequest(
      requestOf("PUT", "/statements", {
        query: { statementId: uuid(14) },
        headers: headers(other.contentType),
        body: other.body,
      }),
      optionsOf(store),
    );
    expect(refused.status).toBe(400);
    expect(reasonOf(refused)).toContain("signs another Statement");
    expect(signed.statement.attachments?.[0]?.usageType).toBe(SIGNATURE_USAGE_TYPE);
  });
});
