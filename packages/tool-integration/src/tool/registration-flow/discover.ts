import { readAnswerJson, requestService } from "@interopkit/core";
import { checkNonEmptyString, checkRecord, checkString, describe } from "@interopkit/core/checks";
import { LtiError } from "../../errors.js";
import type { PlatformConfiguration } from "../../protocol/index.js";
import { readPlatformConfiguration } from "../../protocol/internal.js";
import { isBelowIssuer, refuseAddress } from "./addresses.js";
import type { RegistrationInitiation } from "./initiation.js";
import { type DiscoverPlatformOptions, type RegistrationSettings, readRegistrationOptions } from "./options.js";

/** The media type of the configuration, of a registration and of its answer (Dynamic Registration 1.0 section 3.5.2). */
export const REGISTRATION_MEDIA_TYPE = "application/json";

/** Checks an initiation that the host passes, as `readRegistrationInitiation` returned it. */
export function checkInitiation(value: unknown): RegistrationInitiation {
  checkRecord(value, "The initiation must be an object");
  checkString(value.openidConfiguration, "The openidConfiguration of the initiation");
  if (value.registrationToken !== undefined) {
    checkNonEmptyString(value.registrationToken, "The registrationToken of the initiation");
    return { openidConfiguration: value.openidConfiguration, registrationToken: value.registrationToken };
  }
  return { openidConfiguration: value.openidConfiguration };
}

/** Returns the headers of a request of registration: the media type of the answer, and the registration token when there is one. */
export function registrationHeaders(token: string | undefined): Record<string, string> {
  return { accept: REGISTRATION_MEDIA_TYPE, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) };
}

/** Returns the call of a step: the `fetch`, the deadline and the signal. */
export function serviceOf(settings: RegistrationSettings) {
  return {
    fetch: settings.fetch,
    timeoutMs: settings.timeoutMs,
    ...(settings.signal === undefined ? {} : { signal: settings.signal }),
  };
}

/**
 * Fetches the OpenID configuration of a platform that starts a registration, and checks it against its address (Dynamic
 * Registration 1.0 sections 3.4 and 3.5.1).
 *
 * @remarks
 * The address comes from the browser, so it must name a public host before anything is fetched (`checkRemoteUrl`); a redirect is
 * refused, and the answer is read within `maxBytes` and `maxTokens`. The registration token goes with the request when there is
 * one, because some platforms require it there and give the address and the token in one redirect. Then the configuration must
 * be the one of an issuer above its address: the same origin after parsing, a path equal to the issuer's or below it at a slash,
 * and no fragment, which guards against a platform that impersonates another. Every endpoint of the configuration must name a
 * public host.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-dr/v1p0 | LTI Dynamic Registration 1.0}
 * @param initiation - What `readRegistrationInitiation` returned.
 * @param options - The `fetch` and the limits of the call.
 * @returns The configuration of the platform.
 * @throws `LtiError` (`service-origin-refused`) for an address that names no public host, (`issuer-mismatch`) for a configuration
 * whose issuer is not above its address.
 * @throws `DataError` when an argument has the wrong type, or the configuration breaks Dynamic Registration 1.0 section 2.1.
 * @throws `ServiceError` when the platform does not answer with a success, or with more than `maxBytes`.
 */
export async function discoverPlatform(
  initiation: RegistrationInitiation,
  options: DiscoverPlatformOptions,
): Promise<PlatformConfiguration> {
  const settings = readRegistrationOptions(options);
  const { openidConfiguration, registrationToken } = checkInitiation(initiation);
  refuseAddress(openidConfiguration, "The address of the OpenID configuration");
  const what = `The OpenID configuration at ${openidConfiguration}`;
  const response = await requestService(
    serviceOf(settings),
    what,
    openidConfiguration,
    { method: "GET", headers: registrationHeaders(registrationToken) },
    { maxBytes: settings.maxBytes },
  );
  const platform = readPlatformConfiguration(readAnswerJson(response, what, { maxTokens: settings.maxTokens }));
  if (!isBelowIssuer(openidConfiguration, platform.issuer)) {
    throw new LtiError(
      `The OpenID configuration at ${describe(openidConfiguration)} is not below its issuer ${describe(platform.issuer)}.`,
      "issuer-mismatch",
    );
  }
  const endpoints = [
    ["authorization endpoint", platform.authorizationEndpoint],
    ["registration endpoint", platform.registrationEndpoint],
    ["key set", platform.jwksUri],
    ["token endpoint", platform.tokenEndpoint],
  ] as const;
  for (const [name, url] of endpoints) refuseAddress(url, `The ${name} of the platform`);
  return platform;
}
