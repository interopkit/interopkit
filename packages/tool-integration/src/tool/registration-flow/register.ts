import { DataError, requestService } from "@interopkit/core";
import type { PlatformConfiguration, ToolRegistrationResult } from "../../protocol/index.js";
import {
  readPlatformConfiguration,
  readToolRegistrationResult,
  writePlatformConfiguration,
} from "../../protocol/internal.js";
import { readAnswer } from "../services/access.js";
import { checkRegistrationAddress } from "./addresses.js";
import { checkInitiation, REGISTRATION_MEDIA_TYPE, registrationHeaders, serviceOf } from "./discover.js";
import type { RegistrationInitiation } from "./initiation.js";
import { type RegisterToolOptions, readRegistrationOptions } from "./options.js";
import { type ToolConfigurationInput, writeToolInput } from "./tool-configuration.js";

/** Reads a platform configuration that the host passes, as `discoverPlatform` returned it, back through its writer. */
export function platformOf(value: unknown): PlatformConfiguration {
  try {
    return readPlatformConfiguration(writePlatformConfiguration(value as PlatformConfiguration));
  } catch (error) {
    // The writer takes the types of the model, and a member of another kind fails it with a TypeError.
    if (error instanceof TypeError) throw new DataError(`The platform configuration is not one: ${error.message}.`);
    throw error;
  }
}

/**
 * Asks a platform to register the tool (Dynamic Registration 1.0 sections 3.5 and 3.6): posts the tool's configuration to the
 * registration endpoint of the platform's configuration, with the registration token of the initiation when there is one, and
 * returns the registration that the platform recorded.
 *
 * @remarks
 * The registration token goes to the registration endpoint, so the endpoint must be on the origin of the issuer, or on one of the
 * `registrationOrigins` that the host trusts, and name a public host; so must the `registration_client_uri` of the answer, which
 * receives tokens later. The platform answers at once, but the tool is active only after the platform's administrator reviews it:
 * the host keeps the result, makes its registration of the platform with `toPlatformRegistration`, and sends the browser the page
 * of `createRegistrationClosePage`. A registration is not idempotent, and a platform spends its token: after a timeout the
 * administrator starts again.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-dr/v1p0 | LTI Dynamic Registration 1.0}
 * @param platform - What `discoverPlatform` returned.
 * @param tool - The configuration of the tool, without what LTI fixes.
 * @param initiation - What `readRegistrationInitiation` returned, for its token.
 * @param options - The `fetch`, the limits and the trusted origins of registration.
 * @returns The registration, with the client identifier and the configuration as the platform recorded it.
 * @throws `LtiError` (`issuer-mismatch`, `service-origin-refused`) for an address of registration that the token may not go to.
 * @throws `DataError` when an argument has the wrong type, the tool configuration breaks section 2.2, or the answer breaks section 2.3.
 * @throws `ServiceError` when the platform refuses the registration (400 `invalid_client_metadata` and its description in the
 * body) or does not answer.
 */
export async function registerTool(
  platform: PlatformConfiguration,
  tool: ToolConfigurationInput,
  initiation: RegistrationInitiation,
  options: RegisterToolOptions,
): Promise<ToolRegistrationResult> {
  const settings = readRegistrationOptions(options);
  const configuration = platformOf(platform);
  const { registrationToken } = checkInitiation(initiation);
  const body = JSON.stringify(writeToolInput(tool));
  const { issuer, registrationEndpoint } = configuration;
  const origins = settings.registrationOrigins;
  checkRegistrationAddress(registrationEndpoint, issuer, origins, "The registration endpoint");
  const what = `The registration endpoint at ${registrationEndpoint}`;
  const headers = { ...registrationHeaders(registrationToken), "content-type": REGISTRATION_MEDIA_TYPE };
  const response = await requestService(
    serviceOf(settings),
    what,
    registrationEndpoint,
    { method: "POST", headers, body },
    { maxBytes: settings.maxBytes },
  );
  const result = readAnswer(response, what, settings.maxTokens, readToolRegistrationResult);
  if (result.registrationClientUri !== undefined) {
    checkRegistrationAddress(
      result.registrationClientUri,
      issuer,
      origins,
      "The registration_client_uri of the answer",
    );
  }
  return result;
}
