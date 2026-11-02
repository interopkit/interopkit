import type { JsonObject } from "@interopkit/core/checks";
import * as v from "valibot";
import type { DeepLinkingSettings } from "../protocol/index.js";
import { IDENTIFIER, NUMBER, STRING, STRING_ARRAY } from "../protocol/internal.js";
import { openToken, sealToken } from "./seal.js";

/** What the hint of a login names: the launch kept in the `LaunchStore`, for one tool, deployment and user, until a time. */
export interface Hint {
  /** The identifier of the launch in the `LaunchStore`. */
  readonly id: string;
  /** The client identifier of the tool that the hint is for. */
  readonly client: string;
  /** The deployment of the launch. */
  readonly deployment: string;
  /** The `sub` of the launch; absent in an anonymous launch. */
  readonly principal?: string;
  /** The time in seconds since 1970-01-01T00:00:00Z at which the hint expires. */
  readonly exp: number;
}

/** What an access token grants, sealed in the token. */
export interface Access {
  /** The client identifier of the tool. */
  readonly client: string;
  /** The deployment that the client assertion named (LTI 1.3 Core section 6.2.1), when it named one. */
  readonly deployment?: string;
  /** The granted scopes. */
  readonly scopes: readonly string[];
  /** The time in seconds since 1970-01-01T00:00:00Z at which the token expires. */
  readonly exp: number;
}

/** What the session data of a Start Proctoring message binds: the attempt of one user at one assessment of one deployment. */
export interface SessionData {
  /** The client identifier of the proctoring tool. */
  readonly client: string;
  /** The deployment of the message. */
  readonly deployment: string;
  /** The identifier of the resource link of the assessment. */
  readonly resourceLink: string;
  /** The attempt. */
  readonly attempt: number;
  /** The `sub` of the message; absent in an anonymous launch. */
  readonly subject?: string;
  /** The time in seconds since 1970-01-01T00:00:00Z at which the session data expires. */
  readonly exp: number;
}

/** What the data of a Deep Linking request carries: the settings of the request and the host's own data. */
export interface DeepLinkingData {
  /** The client identifier of the tool. */
  readonly client: string;
  /** The deployment of the request. */
  readonly deployment: string;
  /** The settings of the request. */
  readonly settings: Omit<DeepLinkingSettings, "data">;
  /** The host's own data, returned after the response is verified. */
  readonly data?: JsonObject;
  /** The time in seconds since 1970-01-01T00:00:00Z at which the data expires. */
  readonly exp: number;
}

const hintSchema = v.object({
  id: STRING,
  client: STRING,
  deployment: STRING,
  principal: v.optional(IDENTIFIER),
  exp: NUMBER,
});

const accessSchema = v.object({
  client: STRING,
  deployment: v.optional(STRING),
  scopes: STRING_ARRAY,
  exp: NUMBER,
});

/** Seals a hint. */
export function sealHint(hint: Hint, key: CryptoKey): Promise<string> {
  return sealToken("hint", { ...hint }, key);
}

/** Opens a hint, or returns `undefined` when the token is not a hint that this platform sealed. */
export async function openHint(token: string, keys: readonly CryptoKey[]): Promise<Hint | undefined> {
  const claims = await openToken(token, "hint", keys);
  const parsed = v.safeParse(hintSchema, claims);
  return parsed.success ? parsed.output : undefined;
}

/** Seals the `login_hint`: the identifier of the launch, signed so that the platform knows the hint is its own. */
export function sealLoginHint(id: string, key: CryptoKey): Promise<string> {
  return sealToken("login", { id }, key);
}

/** Opens a `login_hint`, and returns the identifier of the launch, or `undefined` when the token is not one. */
export async function openLoginHint(token: string, keys: readonly CryptoKey[]): Promise<string | undefined> {
  const claims = await openToken(token, "login", keys);
  return typeof claims?.id === "string" ? claims.id : undefined;
}

/** Seals an access token. */
export function sealAccess(access: Access, key: CryptoKey): Promise<string> {
  return sealToken("access", { ...access }, key);
}

/** Opens an access token, or returns `undefined` when it is not one this platform sealed. */
export async function openAccess(token: string, keys: readonly CryptoKey[]): Promise<Access | undefined> {
  const claims = await openToken(token, "access", keys);
  const parsed = v.safeParse(accessSchema, claims);
  return parsed.success ? parsed.output : undefined;
}

/** Seals the session data of a Start Proctoring message (Proctoring Services 1.0 section 4.2.2.5). */
export function sealSessionData(session: SessionData, key: CryptoKey): Promise<string> {
  return sealToken("session-data", { ...session }, key);
}

/** Seals the data of a Deep Linking request (Deep Linking 2.0 section 4.4.1), which the tool's response returns. */
export function sealDeepLinkingData(data: DeepLinkingData, key: CryptoKey): Promise<string> {
  return sealToken("deep-linking-data", { ...data }, key);
}
