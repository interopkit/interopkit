import { readClock } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { LtiError } from "../errors.js";
import { callOptionsOf, randomToken, toSeconds } from "../protocol/internal.js";
import { endpointsOf, type PlatformConfig } from "./config.js";
import { checkLoginOptions, type PlatformLoginOptions } from "./options.js";
import { checkToolRegistration, type ToolRegistration } from "./registration.js";
import { sealHint, sealLoginHint } from "./tokens.js";
import { checkToolLaunch, type ToolLaunch } from "./tool-launch.js";

/** How long a hint is valid, in seconds. It is the time for the browser to go to the tool and back. */
export const LTI_HINT_TTL_SECONDS = 300;

/** The name of the frame that shows the storage page, when the host names none. */
const DEFAULT_STORAGE_TARGET = "lti-storage";

/**
 * Refuses a URL on one of the platform's own origins. The tool's frame has `allow-same-origin`, so a tool on the origin of the
 * frame page could reach that page; one on the platform's or a reserved origin would reach their pages.
 */
function refuseOwnOrigins(urls: readonly string[], config: PlatformConfig): void {
  const own = [config.origin, config.frameOrigin, ...config.reservedOrigins];
  for (const url of urls) {
    if (own.includes(new URL(url).origin)) {
      throw new LtiError(
        `The tool must not be launched from ${describe(url)}, which is on an origin of the platform.`,
        "origin-refused",
      );
    }
  }
}

/** A login that the platform prepared: the URL to send the browser to, and the registration of the tool it is for. */
interface Prepared {
  readonly url: string;
  readonly registration: ToolRegistration;
}

/** Checks the arguments, finds the tool and builds the URL of its login with the signed hints. */
async function prepare(launch: ToolLaunch, options: PlatformLoginOptions): Promise<Prepared> {
  checkLoginOptions(options);
  checkToolLaunch(launch);
  const { config } = options;
  const call = callOptionsOf(options);
  await options.check(launch, call);
  const registration: ToolRegistration | undefined = await options.registration(launch, call);
  if (registration === undefined) {
    throw new LtiError(`The platform has no tool for the launch ${describe(launch.title)}.`, "tool-unknown");
  }
  checkToolRegistration(registration);
  refuseOwnOrigins([launch.target, registration.loginUrl, ...registration.redirectUris], config);
  options.signal?.throwIfAborted();
  const hint = await sealHint(
    {
      resource: launch.resource,
      principal: launch.principal,
      client: registration.clientId,
      target: launch.target,
      custom: { ...launch.custom },
      title: launch.title,
      scoreMaximum: launch.scoreMaximum,
      jti: randomToken(),
      exp: toSeconds(readClock(options.clock)) + LTI_HINT_TTL_SECONDS,
    },
    config.hintKey,
  );
  const url = new URL(registration.loginUrl);
  const parameters: readonly (readonly [string, string])[] = [
    ["iss", config.issuer],
    ["login_hint", await sealLoginHint(launch.principal, config.hintKey)],
    ["lti_message_hint", hint],
    ["target_link_uri", launch.target],
    ["client_id", registration.clientId],
    ["lti_deployment_id", registration.deploymentId],
    ["lti_storage_target", options.storageTarget ?? DEFAULT_STORAGE_TARGET],
  ];
  for (const [name, value] of parameters) url.searchParams.append(name, value);
  return { url: url.href, registration };
}

/** The frame of a tool: what the page that shows it needs. */
export interface PlatformFrame {
  /** The URL of the tool's login, to which the frame of the tool navigates. */
  readonly url: string;
  /** The URL of the storage page, which a frame named `storageTarget` shows beside the frame of the tool. */
  readonly storageUrl: string;
  /**
   * The `allow` attribute of the tool's frame.
   *
   * @defaultValue none, so that the tool may use no feature that needs permission
   */
  readonly allow?: string;
}

/**
 * Prepares the launch of a tool and returns the URL of the tool's third-party initiated login for the frame to navigate to.
 *
 * @remarks
 * The URL carries `iss`, `client_id`, `lti_deployment_id`, `target_link_uri` and `lti_storage_target`, and two hints:
 * `lti_message_hint` is HMAC-signed and names the resource and the principal with a random `jti` and an expiry of 300
 * seconds, and `login_hint` is the principal, signed with the same key. The hint also carries the launch's target, custom
 * properties and title, and the highest score, which `ltiPlatformAuthorize` puts in the launch. It is signed and not
 * encrypted, so the tool can read the resource and the principal. The order is: `check`, `registration`, the origins, then
 * the hint, so that nothing is signed for a launch that is not the caller's.
 *
 * @see {@link https://www.imsglobal.org/spec/security/v1p1/#step-1-third-party-initiated-login | LTI Security Framework 1.1, third-party initiated login}
 * @param launch - The launch of the tool.
 * @param options - The platform, its tools and the check of the caller.
 * @returns The URL of the tool's login.
 * @throws `DataError` when an argument or an option has the wrong type, or the launch is not valid.
 * @throws `LtiError` (`tool-unknown`) when the platform has no tool for the launch, and (`origin-refused`) when the target
 * or the tool's URLs are on the platform's, the frame page's or a reserved origin.
 * @throws The error of `options.check`, which stops the launch before anything is signed.
 * @throws The `reason` of `options.signal` when it aborts before the hint is signed.
 */
export async function ltiPlatformLogin(launch: ToolLaunch, options: PlatformLoginOptions): Promise<string> {
  return (await prepare(launch, options)).url;
}

/**
 * Prepares the launch of a tool as `ltiPlatformLogin` does, and returns what the page that shows it needs: the URL of the
 * login, the URL of the storage page, and the `allow` list of the tool's registration.
 *
 * @param launch - The launch of the tool.
 * @param options - The platform, its tools and the check of the caller.
 * @returns The frame of the tool.
 * @throws As {@link ltiPlatformLogin} does.
 */
export async function ltiPlatformFrame(launch: ToolLaunch, options: PlatformLoginOptions): Promise<PlatformFrame> {
  const { url, registration } = await prepare(launch, options);
  const { allow } = registration;
  return { url, storageUrl: endpointsOf(options.config).storage, ...(allow === undefined ? {} : { allow }) };
}
