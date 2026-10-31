import { LtiError } from "../errors.js";
import {
  IDENTIFIER,
  NUMBER,
  POSITIVE_NUMBER,
  required,
  STRING,
  STRING_ARRAY,
  STRING_RECORD,
} from "../protocol/internal.js";
import { openToken, sealToken } from "./seal.js";

const OWNER = "The sealed token";

/** What the platform remembers of a login between the login URL and the authentication request, sealed in the hint. */
export interface Hint {
  /** What the launch is for, in the host's terms. */
  readonly resource: string;
  /** The authenticated principal; the `sub` of the launch. */
  readonly principal: string;
  /** The client identifier of the tool that the hint is for. */
  readonly client: string;
  /** The tool's `target_link_uri`. */
  readonly target: string;
  /** The custom properties of the link, by name. */
  readonly custom: Readonly<Record<string, string>>;
  /** The title of the link, which labels the line item. */
  readonly title: string;
  /** The highest score, which is the `scoreMaximum` of the line item. */
  readonly scoreMaximum: number;
  /** The identifier that makes the hint single-use. */
  readonly jti: string;
  /** The time in seconds since 1970-01-01T00:00:00Z at which the hint expires. */
  readonly exp: number;
}

/** What the URL of a line item holds, sealed in its identifier. */
export interface LineItem {
  /** What the launch is for, in the host's terms. */
  readonly resource: string;
  /** The client identifier of the tool that may use the line item. */
  readonly client: string;
  /** The `sub` of the launch: the only user a score may be for. */
  readonly subject: string;
  /** The label of the line item. */
  readonly title: string;
  /** The `scoreMaximum` of the line item. */
  readonly scoreMaximum: number;
}

/** What an access token grants, sealed in the token. */
export interface Access {
  /** The client identifier of the tool. */
  readonly client: string;
  /** The granted scopes. */
  readonly scopes: readonly string[];
  /** The time in seconds since 1970-01-01T00:00:00Z at which the token expires. */
  readonly exp: number;
}

/** Seals a hint. */
export function sealHint(hint: Hint, key: CryptoKey): Promise<string> {
  return sealToken("hint", { ...hint }, key);
}

/**
 * Opens a hint.
 *
 * @throws `LtiError` (`hint-invalid`) when the token is not a hint that this platform sealed.
 */
export async function openHint(token: string, key: CryptoKey): Promise<Hint> {
  const invalid = () => new LtiError("The lti_message_hint is not a hint that this platform issued.", "hint-invalid");
  const claims = await openToken(token, "hint", key);
  if (claims === undefined) throw invalid();
  try {
    return {
      resource: required(claims, "resource", OWNER, STRING),
      principal: required(claims, "principal", OWNER, IDENTIFIER),
      client: required(claims, "client", OWNER, STRING),
      target: required(claims, "target", OWNER, STRING),
      custom: Object.fromEntries(required(claims, "custom", OWNER, STRING_RECORD)),
      title: required(claims, "title", OWNER, STRING),
      scoreMaximum: required(claims, "scoreMaximum", OWNER, POSITIVE_NUMBER),
      jti: required(claims, "jti", OWNER, STRING),
      exp: required(claims, "exp", OWNER, NUMBER),
    };
  } catch (error) {
    if (error instanceof LtiError) throw invalid();
    throw error;
  }
}

/** Seals the `login_hint`: the principal, signed so that the platform knows the hint is its own. */
export function sealLoginHint(principal: string, key: CryptoKey): Promise<string> {
  return sealToken("login", { principal }, key);
}

/** Opens a `login_hint`, and returns the principal, or `undefined` when the token is not one. */
export async function openLoginHint(token: string, key: CryptoKey): Promise<string | undefined> {
  const claims = await openToken(token, "login", key);
  return typeof claims?.principal === "string" ? claims.principal : undefined;
}

/** Seals a line item into the identifier in its URL. */
export function sealLineItem(lineItem: LineItem, key: CryptoKey): Promise<string> {
  return sealToken("line-item", { ...lineItem }, key);
}

/** Opens the identifier of a line item, or returns `undefined` when it is not one. */
export async function openLineItem(token: string, key: CryptoKey): Promise<LineItem | undefined> {
  const claims = await openToken(token, "line-item", key);
  if (claims === undefined) return undefined;
  try {
    return {
      resource: required(claims, "resource", OWNER, STRING),
      client: required(claims, "client", OWNER, STRING),
      subject: required(claims, "subject", OWNER, IDENTIFIER),
      title: required(claims, "title", OWNER, STRING),
      scoreMaximum: required(claims, "scoreMaximum", OWNER, POSITIVE_NUMBER),
    };
  } catch (error) {
    if (error instanceof LtiError) return undefined;
    throw error;
  }
}

/** Seals an access token. */
export function sealAccess(access: Access, key: CryptoKey): Promise<string> {
  return sealToken("access", { ...access }, key);
}

/** Opens an access token, or returns `undefined` when it is not one this platform sealed. */
export async function openAccess(token: string, key: CryptoKey): Promise<Access | undefined> {
  const claims = await openToken(token, "access", key);
  if (claims === undefined) return undefined;
  try {
    const scopes = required(claims, "scopes", OWNER, STRING_ARRAY);
    return { client: required(claims, "client", OWNER, STRING), scopes, exp: required(claims, "exp", OWNER, NUMBER) };
  } catch (error) {
    if (error instanceof LtiError) return undefined;
    throw error;
  }
}
