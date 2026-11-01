import type { LanguageMap } from "./language-map.js";

/** The header of an Attachment of a Statement (4.2.2.6); the data travel apart from the Statement. */
export interface Attachment {
  /** Identifies the usage of the Attachment, an IRI. A signature has the usage type `http://adlnet.gov/expapi/attachments/signature`. */
  readonly usageType: string;
  /** The name of the Attachment. */
  readonly display: LanguageMap;
  /** A description of the Attachment. */
  readonly description?: LanguageMap;
  /** The Internet media type of the data. */
  readonly contentType: string;
  /** The length of the data in octets. */
  readonly length: number;
  /** The SHA-2 hash of the data as hexadecimal digits. It is required even when `fileUrl` is given. */
  readonly sha2: string;
  /** An IRL at which the data can be retrieved, or could be. */
  readonly fileUrl?: string;
}

/** The data of an Attachment, which travel apart from the Statement and are matched to its header by the hash (4.1.3). */
export interface AttachmentData {
  /** The SHA-2 hash of the data as hexadecimal digits: the `sha2` of the header, and the `X-Experience-API-Hash` of the part. */
  readonly sha2: string;
  /** The Internet media type of the data, such as `application/octet-stream`. */
  readonly contentType: string;
  /** The data. */
  readonly body: Uint8Array;
}
