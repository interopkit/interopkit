import { DataError } from "@interopkit/core";
import {
  checkNonEmptyString,
  checkRecord,
  nonEmptyStringSchema,
  parseWith,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type { ToolConfiguration } from "../../protocol/index.js";
import { IDENTIFIER, readToolConfiguration, writeToolConfiguration } from "../../protocol/internal.js";
import type { RegisteredTool } from "../ports.js";
import { checkToolRegistration, type ToolRegistration } from "../registration.js";

/** What the platform's administrator grants a tool when they activate its registration. */
export interface RegistrationGrant {
  /** The scopes of the services that the tool may use, which may be fewer or more than it asked for (Dynamic Registration 1.0 section 3.2). */
  readonly scopes: readonly string[];
  /** The deployments of the tool, at least one, such as the `deploymentId` of the configuration. */
  readonly deploymentIds: readonly string[];
}

const grantSchema = strictRecord({
  scopes: v.array(nonEmptyStringSchema),
  deploymentIds: v.pipe(v.array(IDENTIFIER), v.minLength(1)),
});

/** Reads the configuration of a registered tool that the host passes, back through its writer. */
function configurationOf(value: unknown): ToolConfiguration {
  try {
    return readToolConfiguration(writeToolConfiguration(value as ToolConfiguration));
  } catch (error) {
    // The writer takes the types of the model, and a member of another kind fails it with a TypeError.
    if (error instanceof TypeError) throw new DataError(`The configuration of the tool is not one: ${error.message}.`);
    throw error;
  }
}

/**
 * Returns the registration of a tool that the platform launches, from the registration that Dynamic Registration recorded and
 * what the administrator grants: the login initiation URL, the redirect URIs, the key set URL and the custom properties of the
 * configuration, and the scopes and the deployments of the grant. The host gives it to its lookup of tools when it activates the
 * tool (Dynamic Registration 1.0 section 3.7).
 *
 * @param registered - The registration that the `RegistrationStore` keeps.
 * @param grant - The scopes and the deployments that the administrator grants.
 * @returns The registration of the tool.
 * @throws `DataError` when an argument has the wrong type, or the configuration breaks Dynamic Registration 1.0 section 2.2.
 */
export function buildToolRegistration(registered: RegisteredTool, grant: RegistrationGrant): ToolRegistration {
  checkRecord(registered, "The registered tool must be an object");
  checkNonEmptyString(registered.clientId, "The client identifier of the registered tool");
  const configuration = configurationOf(registered.configuration);
  const { scopes, deploymentIds } = parseWith(grantSchema, grant, "The grant");
  const custom = configuration.lti.customParameters;
  const registration = {
    clientId: registered.clientId,
    deploymentIds,
    loginUrl: configuration.initiateLoginUri,
    redirectUris: [...configuration.redirectUris],
    jwksUrl: configuration.jwksUri,
    scopes,
    ...(custom === undefined ? {} : { custom: Object.fromEntries(custom) }),
  };
  checkToolRegistration(registration);
  return registration;
}
