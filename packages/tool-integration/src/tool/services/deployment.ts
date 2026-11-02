import { checkNonEmptyString, checkRecord } from "@interopkit/core/checks";
import type { LtiDeployment } from "../../protocol/index.js";

/**
 * Checks the deployment that a client of the services is for, as a host passes it from JavaScript, such as a launch.
 *
 * @throws `DataError` when it has no issuer, client identifier or deployment.
 */
export function checkDeployment(value: unknown): asserts value is LtiDeployment {
  checkRecord(value, "The deployment must be an object");
  checkNonEmptyString(value.issuer, "The issuer of the deployment");
  checkNonEmptyString(value.clientId, "The client identifier of the deployment");
  checkNonEmptyString(value.deploymentId, "The deployment");
}
