import { readClock } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { LtiError } from "../errors.js";
import { callOptionsOf, MILLISECONDS, randomToken, toSeconds, writeMessage } from "../protocol/internal.js";
import { DEFAULT_STORAGE_TARGET } from "./capabilities.js";
import { endpointsOf, type PlatformConfig } from "./config.js";
import { type MessageInput, readMessageInput } from "./messages/input.js";
import { toWrite } from "./messages/write.js";
import { checkLoginOptions, type PlatformLoginOptions } from "./options.js";
import { readToolRegistration, type ToolRegistration } from "./registration.js";
import { sealHint, sealLoginHint } from "./tokens.js";

/** How long a launch is kept, and its hint valid, in seconds: the time for the browser to go to the tool and back. */
export const LAUNCH_TTL_SECONDS = 300;

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

/** Checks the arguments, finds the tool, keeps the message and builds the URL of the tool's login with the sealed hints. */
async function prepare(input: MessageInput, options: PlatformLoginOptions): Promise<Prepared> {
  checkLoginOptions(options);
  const message = readMessageInput(input, "The message");
  const { config } = options;
  // The rules that bind the sender hold before the message is kept, so that the authentication request cannot fail on them.
  writeMessage(toWrite(message, { issuer: config.issuer, custom: new Map(Object.entries(message.custom ?? {})) }));
  const call = callOptionsOf(options);
  await options.check(message, call);
  const registration = readToolRegistration(await options.registration(message.clientId, call), message.clientId);
  if (registration === undefined) {
    throw new LtiError(
      `The platform has no tool with the client identifier ${describe(message.clientId)}.`,
      "tool-unknown",
    );
  }
  if (!registration.deploymentIds.includes(message.deploymentId)) {
    throw new LtiError(
      `The deployment ${describe(message.deploymentId)} is not one of the deployments of the tool.`,
      "deployment-unknown",
    );
  }
  refuseOwnOrigins([message.targetLinkUri, registration.loginUrl, ...registration.redirectUris], config);
  options.signal?.throwIfAborted();
  const id = randomToken();
  const exp = toSeconds(readClock(options.clock)) + LAUNCH_TTL_SECONDS;
  await options.launches.put(id, message, exp * MILLISECONDS, call);
  const hint = await sealHint(
    {
      id,
      client: registration.clientId,
      deployment: message.deploymentId,
      ...(message.user.subject === undefined ? {} : { principal: message.user.subject }),
      exp,
    },
    config.hintKey,
  );
  const url = new URL(registration.loginUrl);
  const parameters: readonly (readonly [string, string])[] = [
    ["iss", config.issuer],
    ["login_hint", await sealLoginHint(id, config.hintKey)],
    ["lti_message_hint", hint],
    ["target_link_uri", message.targetLinkUri],
    ["client_id", registration.clientId],
    ["lti_deployment_id", message.deploymentId],
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
 * Keeps a message for a tool and returns the URL of the tool's third-party initiated login, for the frame to navigate to.
 *
 * @remarks
 * The order is: the message is read and held to the rules of the sender, `check` confirms that it is the caller's, the tool is
 * looked up with `registration`, the deployment must be one of the tool's, and the target and the tool's URLs must be on none of
 * the platform's origins. Only then is the message kept in `launches` for 300 seconds, under a random identifier. The URL
 * carries `iss`, `client_id`, `lti_deployment_id`, `target_link_uri` and `lti_storage_target`, and two hints sealed with the
 * hint key: `lti_message_hint` names the kept message, the tool, the deployment and the user with an expiry of 300 seconds,
 * and `login_hint` names the kept message. They are signed and not encrypted.
 *
 * @see {@link https://www.imsglobal.org/spec/security/v1p1/#step-1-third-party-initiated-login | LTI Security Framework 1.1, third-party initiated login}
 * @param message - The message to send the tool.
 * @param options - The platform, its tools, the check of the caller and the store of launches.
 * @returns The URL of the tool's login.
 * @throws `DataError` when an argument or an option has the wrong type, the message is not valid or breaks a rule of the
 * sender (LTI 1.3 Core sections 5.3 and 5.4), or the registration is not one.
 * @throws `LtiError` (`tool-unknown`) when the platform has no tool with the client identifier, (`deployment-unknown`) when
 * the deployment is not the tool's, and (`origin-refused`) when the target or the tool's URLs are on the platform's, the frame
 * page's or a reserved origin.
 * @throws The error of `options.check`, `options.registration` or `options.launches.put`, which stop the launch before
 * anything is signed.
 * @throws The `reason` of `options.signal` when it aborts.
 */
export async function ltiPlatformLogin(message: MessageInput, options: PlatformLoginOptions): Promise<string> {
  return (await prepare(message, options)).url;
}

/**
 * Keeps a message for a tool as `ltiPlatformLogin` does, and returns what the page that shows the tool needs: the URL of the
 * login, the URL of the storage page, and the `allow` list of the tool's registration.
 *
 * @param message - The message to send the tool.
 * @param options - The platform, its tools, the check of the caller and the store of launches.
 * @returns The frame of the tool.
 * @throws As {@link ltiPlatformLogin} does.
 */
export async function ltiPlatformFrame(message: MessageInput, options: PlatformLoginOptions): Promise<PlatformFrame> {
  const { url, registration } = await prepare(message, options);
  const { allow } = registration;
  return { url, storageUrl: endpointsOf(options.config).storage, ...(allow === undefined ? {} : { allow }) };
}
