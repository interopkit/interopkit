import { createHash } from "node:crypto";
import type { AttachmentData, Statement } from "../src/index.js";
import { minimalStatement } from "./full-statement.js";

const encoder = new TextEncoder();

/** The hash of node:crypto, an implementation that shares no code with the package. */
export function sha2Of(
  data: Uint8Array | string,
  algorithm: "sha224" | "sha256" | "sha384" | "sha512" = "sha256",
): string {
  return createHash(algorithm).update(data).digest("hex");
}

/** The data of an Attachment from text, with the hash that the header names. */
export function dataOf(text: string, contentType = "text/plain"): AttachmentData {
  const body = encoder.encode(text);
  return { sha2: sha2Of(body), contentType, body };
}

/** A Statement whose `attachments` list the headers of the given data, with a `fileUrl` for those in `withUrl`. */
export function statementWithAttachments(data: readonly AttachmentData[], withUrl: readonly string[] = []): Statement {
  return {
    ...minimalStatement(),
    attachments: data.map(({ sha2, contentType, body }) => ({
      usageType: "https://example.org/attachments/usage",
      display: { "en-US": "An attachment" },
      contentType,
      length: body.byteLength,
      sha2,
      ...(withUrl.includes(sha2) ? { fileUrl: `https://example.org/attachments/${sha2}` } : {}),
    })),
  };
}

/** A multipart message written by hand, with the line ends and the headers that a Learning Record Provider sends. */
export function messageOf(
  boundary: string,
  first: string,
  parts: readonly { headers: string[]; body: string }[],
): Uint8Array {
  const sections = [
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${first}`,
    ...parts.map(({ headers, body }) => `--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n${body}`),
  ];
  return encoder.encode(`${sections.join("\r\n")}\r\n--${boundary}--\r\n`);
}
