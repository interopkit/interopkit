import { DataError, type Signer } from "@interopkit/core";
import { checkArray, checkRecord, checkString, describe } from "@interopkit/core/checks";
import type { PlatformConfiguration, ToolRegistrationResult } from "../../protocol/index.js";
import { readToolRegistrationResult, writeToolRegistrationResult } from "../../protocol/internal.js";
import { checkPlatformRegistration, type PlatformRegistration } from "../registration.js";
import { platformOf } from "./register.js";

/** What the tool adds to a registration to make its record of the platform. */
export interface PlatformRegistrationInput {
  /** Signs the tool's client assertions and messages, with the key whose public key is in the key set at its `jwks_uri`. */
  readonly signer: Signer;
  /** The launch URL that the tool's authentication requests name: one of the redirect URIs of the registration. */
  readonly redirectUri: string;
  /**
   * The deployments of the tool at the platform.
   *
   * @defaultValue the `deploymentId` of the registration, when the platform combined registration and deployment
   */
  readonly deploymentIds?: readonly string[];
}

/** Reads a registration that the host passes, as `registerTool` returned it, back through its writer. */
function resultOf(value: unknown): ToolRegistrationResult {
  try {
    return readToolRegistrationResult(writeToolRegistrationResult(value as ToolRegistrationResult));
  } catch (error) {
    // The writer takes the types of the model, and a member of another kind fails it with a TypeError.
    if (error instanceof TypeError) throw new DataError(`The registration is not one: ${error.message}.`);
    throw error;
  }
}

/**
 * Returns the tool's record of a platform from its OpenID configuration and the registration it recorded: the issuer, the
 * authorization, token and key set endpoints, the audience of a client assertion, and the client identifier, with the tool's
 * signer, launch URL and deployments. The host keeps it with its registrations, and uses it when the platform's administrator has
 * activated the tool (Dynamic Registration 1.0 section 3.7).
 *
 * @param platform - What `discoverPlatform` returned.
 * @param result - What `registerTool` returned.
 * @param tool - The signer, the launch URL and the deployments.
 * @returns The registration of the platform, which `ltiLogin`, `ltiLaunch` and `createServiceClient` read.
 * @throws `DataError` when an argument has the wrong type, the launch URL is not a redirect URI of the registration, or the
 * platform named no deployment and `tool.deploymentIds` gives none.
 */
export function toPlatformRegistration(
  platform: PlatformConfiguration,
  result: ToolRegistrationResult,
  tool: PlatformRegistrationInput,
): PlatformRegistration {
  const configuration = platformOf(platform);
  const registration = resultOf(result);
  checkRecord(tool, "The input must be an object");
  checkString(tool.redirectUri, "The redirectUri of the input");
  if (!registration.redirectUris.includes(tool.redirectUri)) {
    throw new DataError(
      `The redirectUri ${describe(tool.redirectUri)} must be one of the redirect URIs of the registration, ${registration.redirectUris.join(", ")}.`,
    );
  }
  if (tool.deploymentIds !== undefined)
    checkArray(tool.deploymentIds, "The deploymentIds of the input must be an array");
  const named = registration.lti.deploymentId;
  const deploymentIds = tool.deploymentIds ?? (named === undefined ? undefined : [named]);
  if (deploymentIds === undefined) {
    throw new DataError("The platform named no deployment in the registration: give the deploymentIds of the tool.");
  }
  const record = {
    issuer: configuration.issuer,
    clientId: registration.clientId,
    deploymentIds: [...deploymentIds],
    authenticationUrl: configuration.authorizationEndpoint,
    jwksUrl: configuration.jwksUri,
    accessTokenUrl: configuration.tokenEndpoint,
    ...(configuration.authorizationServer === undefined ? {} : { audience: configuration.authorizationServer }),
    redirectUri: tool.redirectUri,
    signer: tool.signer,
  };
  checkPlatformRegistration(record);
  return record;
}
