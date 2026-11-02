import type { LtiDeployment } from "../../protocol/index.js";
import { createServiceAccess } from "./access.js";
import { checkDeployment } from "./deployment.js";
import { type GradesClient, gradesClient } from "./grades.js";
import { readServiceClientOptions, type ServiceClientOptions } from "./options.js";

/** The client of the services of a platform for one deployment: one interface for each service. */
export type ServiceClient = GradesClient;

/**
 * Creates the client of the services of a platform for one deployment: each call asks for a token of the narrowest scope that
 * the platform offered, reuses it until it is about to expire, and sends it only to the service origins of the registration.
 *
 * @remarks
 * A token is shared work: the callers of one scope share one token request, which runs to its own deadline and takes no
 * caller's signal, and a 401 drops the token so that the next call asks for a new one. Nothing retries: a `ServiceError` carries
 * the status, the headers (with `Retry-After`) and the body of the answer. Every answer is read strictly into its model, within
 * `maxBytes` and `maxTokens`, and is a `DataError` at the first invalid member. A host keeps one client for each deployment, so
 * that its tokens are reused.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0 | LTI Assignment and Grade Services 2.0}
 * @param deployment - The platform, the client and the deployment, as a launch gives them.
 * @param options - The registrations, the clock, the `fetch`, the scopes that the platform offered and the limits.
 * @returns The client.
 * @throws `DataError` when an argument or an option has the wrong type.
 */
export function createServiceClient(deployment: LtiDeployment, options: ServiceClientOptions): ServiceClient {
  const settings = readServiceClientOptions(options);
  checkDeployment(deployment);
  const access = createServiceAccess(
    { issuer: deployment.issuer, clientId: deployment.clientId, deploymentId: deployment.deploymentId },
    settings,
  );
  return { ...gradesClient(access) };
}
