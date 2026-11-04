import { DataError } from "@interopkit/core";
import { checkHttpsUrl, describe } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest } from "@interopkit/core/http";
import { LtiError } from "../../errors.js";

/** The registration that a platform starts in the browser (Dynamic Registration 1.0 section 3.3): plain data that a session can keep. */
export interface RegistrationInitiation {
  /** The address of the platform's OpenID configuration, `openid_configuration`. */
  readonly openidConfiguration: string;
  /**
   * The token of the registration request, `registration_token`, which the platform may give.
   *
   * @defaultValue none
   */
  readonly registrationToken?: string;
}

/** Returns the one value of a query parameter, or `undefined` when it is absent. */
function single(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name);
  if (values.length > 1) {
    throw new LtiError(`The parameter ${name} must be given once, found ${values.length} times.`, "request-invalid");
  }
  return values[0];
}

/**
 * Reads the registration initiation request that a platform sends the browser to (Dynamic Registration 1.0 section 3.3): a GET of
 * the tool's initiation URL with `openid_configuration` and, when the platform gives one, `registration_token`.
 *
 * @remarks
 * Anyone can send a browser to this route, so the host puts it behind the session of the tool's administrator, and
 * `discoverPlatform` checks the address before it fetches it. The host may show its own pages between this step and the
 * registration, and keep the result in its session.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-dr/v1p0 | LTI Dynamic Registration 1.0}
 * @param request - The request to the tool's initiation URL.
 * @returns The address of the configuration and the token.
 * @throws `LtiError` (`request-invalid`) when the method is not GET, `openid_configuration` is missing or given twice, is not an
 * `https` URL or has a fragment, or `registration_token` is empty or given twice.
 * @throws `DataError` when the request has the wrong type.
 */
export function readRegistrationInitiation(request: HttpRequest): RegistrationInitiation {
  checkHttpRequest(request);
  if (request.method !== "GET") {
    throw new LtiError(`A registration starts with a GET, found ${describe(request.method)}.`, "request-invalid");
  }
  const parameters = new URL(request.url).searchParams;
  const configuration = single(parameters, "openid_configuration");
  try {
    checkHttpsUrl(configuration, "The parameter openid_configuration");
  } catch (error) {
    if (error instanceof DataError) throw new LtiError(error.message, "request-invalid", { cause: error });
    throw error;
  }
  if (new URL(configuration).hash !== "") {
    throw new LtiError(
      `The parameter openid_configuration must not have a fragment, found ${describe(configuration)}.`,
      "request-invalid",
    );
  }
  const token = single(parameters, "registration_token");
  if (token === "") throw new LtiError("The parameter registration_token must not be empty.", "request-invalid");
  return token === undefined
    ? { openidConfiguration: configuration }
    : { openidConfiguration: configuration, registrationToken: token };
}
