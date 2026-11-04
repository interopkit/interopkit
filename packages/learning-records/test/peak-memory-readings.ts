import type { Reading } from "../../../scripts/peak-memory-child.js";
import { hashAttachment, readMultipart } from "../src/attachments/index.js";
import { parseStatementJson, validateStatements } from "../src/index.js";
import { verifyStatementSignature } from "../src/signing/index.js";
import { handleLrsRequest, readBasicAuthorization } from "../src/store/index.js";
import { minimalStatement, uuid } from "./full-statement.js";
import { memory, optionsOf, requestOf } from "./memory-lrs.js";

const MIB = 1024 * 1024;

/** The names of the extension of a signed payload: with the rest of the Statement, near the million tokens that the reader takes. */
const SIGNATURE_NAMES = 249_900;

/** The Statements of the batch, the most that a request takes, and the numbers of the extension of each. */
const STATEMENTS = 1000;
const NUMBERS = 450;

/** The distinct names of the hostile form, each of four characters: `0000=&`, `0001=&`, and so on. */
const FORM_NAMES = 1_500_000;
/** The bytes of one name with its `=` and its `&`. */
const FIELD_BYTES = 6;
const NAME_BYTES = 4;
const BASE = 36;

const base64url = (text: string) => Buffer.from(text).toString("base64url");

/** A message of the Statements and 99 parts, 10 MiB in all, the most that the default limits take. */
function largestMessage(): Uint8Array {
  const encoder = new TextEncoder();
  const size = Math.floor((10 * MIB - 40_000) / 99);
  const chunks: Uint8Array[] = [encoder.encode("--b\r\nContent-Type: application/json\r\n\r\n{}\r\n")];
  for (let index = 0; index < 99; index += 1) {
    const data = new Uint8Array(size).fill(index + 1);
    chunks.push(
      encoder.encode(`--b\r\nX-Experience-API-Hash: ${hashAttachment(data)}\r\n\r\n`),
      data,
      encoder.encode("\r\n"),
    );
  }
  chunks.push(encoder.encode("--b--\r\n"));
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** A batch of the most Statements, each with a list of numbers in an extension, near the most tokens that a request may have. */
function largestBatch(): string {
  const numbers = Array.from({ length: NUMBERS }, (_, index) => index);
  return JSON.stringify(
    Array.from({ length: STATEMENTS }, (_, index) => ({
      ...minimalStatement(),
      id: uuid(index + 1),
      result: { extensions: { "https://example.org/extensions/scores": numbers } },
    })),
  );
}

/** The JWS of a Statement whose extension has as many names as the reader takes tokens for. */
function widestSignature(): Uint8Array {
  const statement = minimalStatement();
  const extensions = `{${Array.from({ length: SIGNATURE_NAMES }, (_, index) => `"https://example.org/k${index}":0`).join(",")}}`;
  const payload = JSON.stringify({
    ...statement,
    object: { ...statement.object, definition: { extensions: {} } },
  }).replace('"extensions":{}', `"extensions":${extensions}`);
  return new TextEncoder().encode(`${base64url('{"alg":"RS256"}')}.${base64url(payload)}.${base64url("signature")}`);
}

/** The form of the alternate request syntax in bytes, with no string on the way, so that the input adds nothing to the heap. */
function hostileForm(): Uint8Array {
  const digits = new TextEncoder().encode("0123456789abcdefghijklmnopqrstuvwxyz");
  const [equals = 0, ampersand = 0] = new TextEncoder().encode("=&");
  const body = new Uint8Array(FORM_NAMES * FIELD_BYTES);
  for (let name = 0; name < FORM_NAMES; name += 1) {
    const start = name * FIELD_BYTES;
    let rest = name;
    for (let place = NAME_BYTES - 1; place >= 0; place -= 1) {
      body[start + place] = digits[rest % BASE] ?? 0;
      rest = Math.floor(rest / BASE);
    }
    body[start + NAME_BYTES] = equals;
    body[start + NAME_BYTES + 1] = ampersand;
  }
  return body;
}

/** The readings of the package, by name. */
export const READINGS = {
  /** A Basic header of 10 MiB that holds no colon. */
  basicHeader: {
    // The base64 of "ABC" again and again.
    input: () => `Basic ${btoa("ABC").repeat(2_621_440)}`,
    read: (authorization: string) =>
      readBasicAuthorization({ headers: { authorization } }) === undefined ? "no credentials" : "credentials",
  },
  /** The text of a request of a million tokens of distinct names, the most that the search for a repeat keeps. */
  statementJson: {
    input: () => `{${Array.from({ length: 249_999 }, (_, index) => `"k${index}":0`).join(",")}}`,
    read: (text: string) => `${Object.keys(parseStatementJson(text) as object).length} names`,
  },
  /** A batch whose Statement has a million wrong Activities: the findings of the limit and one that says it stopped. */
  validateStatements: {
    input: () => ({ ...minimalStatement(), context: { contextActivities: { parent: new Array(1_000_000).fill(0) } } }),
    read: (statement: unknown) => {
      const findings = validateStatements([statement]);
      return `${findings.length} findings, the last ${findings.at(-1)?.rule}`;
    },
  },
  /** The payload of a signature of the most tokens that the reader takes, which no key verifies. */
  signature: {
    input: widestSignature,
    read: async (signature: Uint8Array) => {
      // No key and no chain: the payload is read and compared, and the verdict is that no key verifies it.
      const verdict = await verifyStatementSignature(minimalStatement(), signature);
      return verdict.valid ? "valid" : `invalid, ${verdict.reason}`;
    },
  },
  /** A message of 99 parts and 10 MiB, the most that the default limits take. */
  multipart: {
    input: largestMessage,
    read: (body: Uint8Array) => `${readMultipart("multipart/mixed; boundary=b", body).parts.size} parts`,
  },
  /** The largest batch of Statements that a request takes. */
  storeBatch: {
    input: largestBatch,
    read: async (text: string) => {
      const store = memory();
      const request = requestOf("POST", "/statements", { body: text, headers: { "content-type": "application/json" } });
      const response = await handleLrsRequest(request, optionsOf(store));
      return `status ${response.status}, ${store.held.size} Statements stored`;
    },
  },
  /** A form of the alternate request syntax of a million and a half distinct names. */
  alternateNames: {
    input: hostileForm,
    read: async (body: Uint8Array) => {
      const request = requestOf("POST", "/statements", {
        query: { method: "GET" },
        headers: { "content-type": "application/x-www-form-urlencoded", "x-experience-api-version": "1.0.3" },
        body,
      });
      return `status ${(await handleLrsRequest(request, optionsOf(memory()))).status}`;
    },
  },
  /** A form of the alternate request syntax of 10 MiB written as `+`. */
  alternateSpaces: {
    input: () => `content=${"+".repeat(10 * MIB - 8)}`,
    read: async (body: string) => {
      const request = requestOf("POST", "/statements", {
        query: { method: "POST" },
        headers: { "content-type": "application/x-www-form-urlencoded", "x-experience-api-version": "1.0.3" },
        body,
      });
      return `status ${(await handleLrsRequest(request, optionsOf(memory()))).status}`;
    },
  },
} satisfies Record<string, Reading>;
