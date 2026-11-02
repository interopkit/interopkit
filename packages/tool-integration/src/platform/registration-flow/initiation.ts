import { readClock } from "@interopkit/core";
import { checkHttpsUrl } from "@interopkit/core/checks";
import { randomToken, toSeconds } from "../../protocol/internal.js";
import { configurationUrl } from "../config.js";
import { type RegistrationInitiationOptions, readInitiationOptions } from "../options.js";
import { sealRegistrationToken } from "../tokens.js";

/** How long a registration token is valid by default, in seconds: "typically 1 hour" (Dynamic Registration 1.0 section 3.3). */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * Returns the address with which the platform starts the registration of a tool (Dynamic Registration 1.0 section 3.3): the
 * tool's initiation URL with the `openid_configuration` of the platform and a `registration_token`, which the platform's page
 * opens in a frame or a new tab.
 *
 * @remarks
 * The token is sealed with the hint key and names one registration until it expires: `handlePlatformRequest` spends it at the
 * registration endpoint, so a second registration with it, or a retry after a timeout, is refused, and the administrator starts
 * again. The configuration URL is the issuer with `/.well-known/openid-configuration` appended, which a tool accepts only below the
 * issuer.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-dr/v1p0 | LTI Dynamic Registration 1.0}
 * @param initiationUrl - The tool's initiation URL, which its administrator gave the platform's administrator; its own query is
 * kept.
 * @param options - The platform, the clock and the lifetime of the token.
 * @returns The address.
 * @throws `DataError` when the initiation URL is not an `https` URL, an option has the wrong type, or the platform cannot serve
 * Dynamic Registration: its issuer is not on its origin, it does not sign with RS256, or `config.instance` has no
 * `productFamilyCode`.
 */
export async function createRegistrationInitiation(
  initiationUrl: string,
  options: RegistrationInitiationOptions,
): Promise<string> {
  const { config, clock, ttlSeconds = DEFAULT_TTL_SECONDS } = readInitiationOptions(options);
  checkHttpsUrl(initiationUrl, "The initiation URL of the tool");
  const exp = toSeconds(readClock(clock)) + ttlSeconds;
  const token = await sealRegistrationToken({ id: randomToken(), exp }, config.hintKey);
  const url = new URL(initiationUrl);
  url.searchParams.set("openid_configuration", configurationUrl(config));
  url.searchParams.set("registration_token", token);
  return url.href;
}
