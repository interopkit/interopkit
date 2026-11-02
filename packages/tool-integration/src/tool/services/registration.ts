import { type CallOptions, DataError } from "@interopkit/core";
import { checkHttpsUrl, checkNonEmptyString, checkRecord, describe } from "@interopkit/core/checks";
import { SCOPES, type ToolRegistrationResult } from "../../protocol/index.js";
import { readToolRegistrationResult } from "../../protocol/internal.js";
import { REGISTRATION_MEDIA_TYPE } from "../registration-flow/discover.js";
import { type ToolConfigurationInput, writeToolInput } from "../registration-flow/tool-configuration.js";
import type { ServiceAccess } from "./access.js";

/** The client of the client configuration endpoint of Dynamic Registration (Dynamic Registration 1.0 section 4) of a platform. */
export interface RegistrationClient {
  /**
   * Returns the registration of the tool as the platform holds it now, with a GET of its `registration_client_uri`.
   *
   * @remarks
   * The request carries the `registration_access_token` of the registration when the platform gave one, and otherwise an access
   * token of `registration.readonly` or `registration` (Dynamic Registration 1.0 section 4.2), the narrowest that the platform
   * offered. Either goes only where every token of the client goes.
   *
   * @param result - The registration that `registerTool` returned, or an earlier answer of this client.
   * @throws `DataError` when the registration has no `registration_client_uri`, or the answer breaks section 2.3 or names another
   * client.
   */
  getToolRegistration(result: ToolRegistrationResult, options?: CallOptions): Promise<ToolRegistrationResult>;
  /**
   * Asks the platform to change the registration of the tool, with a PUT of the configuration to its `registration_client_uri`,
   * and returns what the platform answers: the change may wait for its administrator, so the answer may show it pending and the
   * launches may follow it later (Dynamic Registration 1.0 section 4).
   *
   * @param result - The registration that `registerTool` returned, or an earlier answer of this client.
   * @param tool - The new configuration of the tool, without what LTI fixes.
   * @throws `DataError` as `getToolRegistration` does, and when the configuration breaks section 2.2.
   */
  updateToolRegistration(
    result: ToolRegistrationResult,
    tool: ToolConfigurationInput,
    options?: CallOptions,
  ): Promise<ToolRegistrationResult>;
}

/** The address and the token of the client configuration endpoint of a registration that the host passes. */
function endpointOf(result: unknown): { readonly clientId: string; readonly url: string; readonly bearer?: string } {
  checkRecord(result, "The registration must be an object");
  checkNonEmptyString(result.clientId, "The client identifier of the registration");
  if (result.registrationClientUri === undefined) {
    throw new DataError(
      "The registration has no registrationClientUri: the platform offers no client configuration endpoint.",
    );
  }
  checkHttpsUrl(result.registrationClientUri, "The registrationClientUri of the registration");
  const { clientId, registrationClientUri: url, registrationAccessToken: bearer } = result;
  if (bearer === undefined) return { clientId, url };
  checkNonEmptyString(bearer, "The registrationAccessToken of the registration");
  return { clientId, url, bearer };
}

/** Makes the client of the client configuration endpoint over the access to the services of a platform. */
export function registrationClient(access: ServiceAccess): RegistrationClient {
  /** Reads the answer of the endpoint, which must be the registration of the same client (Dynamic Registration 1.0 section 4.1). */
  const readOf = (clientId: string, url: string) => (value: unknown) => {
    const read = readToolRegistrationResult(value);
    if (read.clientId !== clientId) {
      throw new DataError(
        `The client configuration endpoint at ${url} answered with the registration of ${describe(read.clientId)}, not of ${describe(clientId)}.`,
      );
    }
    return read;
  };
  return {
    async getToolRegistration(result, options) {
      const { clientId, url, bearer } = endpointOf(result);
      const init = {
        method: "GET",
        scopes: [SCOPES.registrationReadonly, SCOPES.registration],
        accept: REGISTRATION_MEDIA_TYPE,
        ...(bearer === undefined ? {} : { bearer }),
      } as const;
      const response = await access.request(url, init, options);
      return access.read(response, `The client configuration endpoint at ${url}`, readOf(clientId, url));
    },
    async updateToolRegistration(result, tool, options) {
      const { clientId, url, bearer } = endpointOf(result);
      // OAuth 2.0 Dynamic Client Registration Management (RFC 7592 section 2.2) has an update name its client.
      // biome-ignore lint/style/useNamingConvention: the name of the member is that of RFC 7592.
      const json = { client_id: clientId, ...writeToolInput(tool) };
      const init = {
        method: "PUT",
        scopes: [SCOPES.registration],
        accept: REGISTRATION_MEDIA_TYPE,
        body: { type: REGISTRATION_MEDIA_TYPE, json },
        ...(bearer === undefined ? {} : { bearer }),
      } as const;
      const response = await access.request(url, init, options);
      return access.read(response, `The client configuration endpoint at ${url}`, readOf(clientId, url));
    },
  };
}
