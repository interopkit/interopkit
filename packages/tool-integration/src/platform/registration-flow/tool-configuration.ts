import { DataError } from "@interopkit/core";
import { checkNonEmptyString, checkRecord, checkRemoteUrl, describe, isRecord } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import type { ToolConfiguration } from "../../protocol/index.js";
import { readToolConfiguration, writeToolConfiguration, writeToolRegistrationResult } from "../../protocol/internal.js";
import { NO_STORE, refusal } from "../answers.js";
import { PATHS } from "../config.js";
import type { PlatformSettings } from "../options.js";
import type { RegisteredTool } from "../ports.js";
import { readBody } from "../services/body.js";
import { fromStore } from "../services/service.js";

/** The media type of a registration request and of its answer (Dynamic Registration 1.0 section 3.5.2). */
const REGISTRATION_MEDIA_TYPE = "application/json";
/** The error of OpenID Connect Dynamic Client Registration 1.0 section 3.3 for a configuration that the platform refuses. */
const INVALID_METADATA = "invalid_client_metadata";
/** The error of the same section for a redirect URI that the platform refuses. */
const INVALID_REDIRECT_URI = "invalid_redirect_uri";
/** The members whose translations are addresses (Dynamic Registration 1.0 section 2.2.1). */
const LOCALIZED_ADDRESSES = ["logo_uri", "client_uri", "tos_uri", "policy_uri"];

/** Returns the address of the client configuration endpoint of a registered tool (Dynamic Registration 1.0 section 4). */
function registrationClientUrl(origin: string, clientId: string): string {
  return `${origin}${PATHS.registration}/${encodeURIComponent(clientId)}`;
}

/**
 * Reads the body of a registration request or an update into the model: 415, 413, and 400 `invalid_client_metadata` for a body
 * that is not JSON or breaks Dynamic Registration 1.0 section 2.2. An update may repeat the `client_id` of its path, and no other.
 */
export function readRegistrationBody(
  request: HttpRequest,
  settings: PlatformSettings,
  clientId?: string,
): { readonly value: ToolConfiguration } | HttpResponse {
  const read = (value: unknown): ToolConfiguration => {
    if (clientId !== undefined && isRecord(value) && value.client_id !== undefined && value.client_id !== clientId) {
      throw new DataError(`The client_id of an update must be the one of its address, ${describe(clientId)}.`);
    }
    return readToolConfiguration(value);
  };
  return readBody(request, REGISTRATION_MEDIA_TYPE, settings.maxBodyBytes, read, INVALID_METADATA);
}

/** Returns every address of a configuration, with the name of its member. */
function addressesOf(configuration: ToolConfiguration): [name: string, url: string][] {
  const { lti } = configuration;
  const listed: [string, string | undefined][] = [
    ["initiate_login_uri", configuration.initiateLoginUri],
    ["jwks_uri", configuration.jwksUri],
    ["logo_uri", configuration.logoUri],
    ["client_uri", configuration.clientUri],
    ["tos_uri", configuration.tosUri],
    ["policy_uri", configuration.policyUri],
    ["target_link_uri", lti.targetLinkUri],
    ...lti.messages.flatMap((message): [string, string | undefined][] => [
      ["target_link_uri of a message", message.targetLinkUri],
      ["icon_uri of a message", message.iconUri],
    ]),
    ...[...(configuration.localized ?? [])].filter(([name]) => LOCALIZED_ADDRESSES.includes(name.split("#")[0] ?? "")),
  ];
  return listed.filter((entry): entry is [string, string] => entry[1] !== undefined);
}

/** Returns why an address of a tool may not be registered, or `undefined` when it may. */
function addressProblem(url: string, name: string, settings: PlatformSettings): string | undefined {
  const { config } = settings;
  try {
    checkRemoteUrl(url, `The ${name}`);
  } catch (error) {
    if (error instanceof DataError) return error.message;
    throw error;
  }
  // The tool's frame has allow-same-origin, so a tool on an origin of the platform would reach the platform's pages.
  if ([config.origin, config.frameOrigin, ...config.reservedOrigins].includes(new URL(url).origin)) {
    return `The ${name} ${describe(url)} is on an origin of the platform.`;
  }
  return undefined;
}

/**
 * Holds a configuration that a tool asks for to the platform's rules, before any store sees it: every address names a public
 * host (`checkRemoteUrl`) on none of the platform's own or reserved origins, so that the platform never fetches the tool's key set
 * from an internal host and never launches a tool on its own origins; and the scopes are narrowed to those the platform offers,
 * since a platform accepts a registration and allows a subset of what it asks (Dynamic Registration 1.0 section 3.2).
 *
 * @param offered - The scopes that the platform offers.
 * @returns The configuration to keep, or the answer: 400 `invalid_redirect_uri` for a redirect URI and `invalid_client_metadata`
 * for any other address.
 */
export function admitConfiguration(
  configuration: ToolConfiguration,
  settings: PlatformSettings,
  offered: readonly string[],
): { readonly value: ToolConfiguration } | HttpResponse {
  for (const url of configuration.redirectUris) {
    const problem = addressProblem(url, "redirect URI", settings);
    if (problem !== undefined) return refusal(400, INVALID_REDIRECT_URI, problem);
  }
  for (const [name, url] of addressesOf(configuration)) {
    const problem = addressProblem(url, name, settings);
    if (problem !== undefined) return refusal(400, INVALID_METADATA, problem);
  }
  const scopes = (configuration.scope ?? "").split(" ").filter((scope) => offered.includes(scope));
  const { scope: _asked, ...rest } = configuration;
  return { value: scopes.length === 0 ? rest : { ...rest, scope: [...new Set(scopes)].join(" ") } };
}

/**
 * Reads a registration that the store answered: a client identifier and a configuration that holds to Dynamic Registration 1.0
 * section 2.2, read back through its writer.
 *
 * @throws `DataError` that names the method of the store when it breaks its contract.
 */
export function storedRegistration(label: string, value: unknown): RegisteredTool {
  return fromStore(label, () => {
    checkRecord(value, "A registered tool must be an object");
    checkNonEmptyString(value.clientId, "The client identifier of a registered tool");
    const configuration = readToolConfiguration(writeToolConfiguration(value.configuration as ToolConfiguration));
    return { clientId: value.clientId, configuration };
  });
}

/** Returns the refusal that a store answered instead of a registration, or `undefined` when it answered one. */
export function storedRefusal(label: string, value: unknown): string | undefined {
  if (!isRecord(value) || !("refusal" in value)) return undefined;
  const { refusal: reason } = value;
  if (typeof reason !== "string" || reason === "") {
    throw new DataError(
      `The answer of ${label} breaks its contract: a refusal must be a sentence, found ${describe(reason)}.`,
    );
  }
  return reason;
}

/**
 * Answers with a registration as the platform recorded it (Dynamic Registration 1.0 sections 2.3 and 3.6.1): its configuration,
 * the client identifier and, when the store reads or updates registrations, the client configuration endpoint, which an access
 * token with a scope of `lti-reg` reaches. It carries no `registration_access_token`, and is not cached.
 */
export function registrationAnswer(status: number, tool: RegisteredTool, settings: PlatformSettings): HttpResponse {
  const store = settings.services?.registrations;
  const configurable = store?.get !== undefined || store?.update !== undefined;
  const result = {
    ...tool.configuration,
    clientId: tool.clientId,
    ...(configurable ? { registrationClientUri: registrationClientUrl(settings.config.origin, tool.clientId) } : {}),
  };
  return buildJsonResponse(status, writeToolRegistrationResult(result), NO_STORE, REGISTRATION_MEDIA_TYPE);
}
