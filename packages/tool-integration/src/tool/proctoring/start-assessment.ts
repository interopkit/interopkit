import { DataError } from "@interopkit/core";
import {
  checkHttpsUrl,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "@interopkit/core/checks";
import type { HttpResponse } from "@interopkit/core/http";
import type { StartProctoringMessage, UserIdentity } from "../../protocol/index.js";
import { LTI_VERSION } from "../../protocol/internal.js";
import { checkToolOptions, findDeployment, type ToolOptions } from "../options.js";
import { postToolMessage } from "../tool-message.js";

const MESSAGE_TYPE = "LtiStartProctoring";

/** What the proctoring tool says when it sends the candidate back to start the assessment. */
export interface StartAssessmentInput {
  /**
   * The identity claims of the candidate that the tool verified, each with the value that the Start Proctoring message gave, and
   * a `picture` that the tool took (Proctoring Services 1.0 sections 3.3 and 4.3.2.1). A claim that the tool did not verify is
   * left out.
   *
   * @defaultValue none
   */
  readonly verifiedUser?: Omit<UserIdentity, "subject">;
  /**
   * Whether the platform sends the tool an End Assessment message when the attempt ends (Proctoring Services 1.0 section 4.3.1.7).
   *
   * @defaultValue `false`
   */
  readonly endAssessmentReturn?: boolean;
}

const INPUT_PROPERTIES = ["verifiedUser", "endAssessmentReturn"];
/** The identity claims of a user that a tool may say it verified, by the name of the model. */
const IDENTITY_TEXT = ["name", "givenName", "familyName", "middleName", "email", "locale"] as const;
const IDENTITY_PROPERTIES = [...IDENTITY_TEXT, "emailVerified", "picture"];

/** Checks the launch that the host passes: a Start Proctoring message that `ltiLaunch` returned. */
function checkLaunch(value: unknown): asserts value is StartProctoringMessage {
  checkRecord(value, "The launch must be an object");
  if (value.messageType !== MESSAGE_TYPE) {
    throw new DataError(`The launch must be a ${MESSAGE_TYPE}, found the message type ${describe(value.messageType)}.`);
  }
  checkNonEmptyString(value.issuer, "The issuer of the launch");
  checkNonEmptyString(value.clientId, "The client identifier of the launch");
  checkNonEmptyString(value.deploymentId, "The deployment of the launch");
  checkHttpsUrl(value.startAssessmentUrl, "The start assessment URL of the launch");
  checkString(value.sessionData, "The session data of the launch");
  checkRecord(value.resourceLink, "The resource link of the launch must be an object");
  checkNonEmptyString(value.resourceLink.id, "The resource link of the launch");
  if (!Number.isSafeInteger(value.attemptNumber) || Number(value.attemptNumber) < 0) {
    throw new DataError(
      `The attempt number of the launch must be a whole number from 0, found ${describe(value.attemptNumber)}.`,
    );
  }
  checkRecord(value.user, "The user of the launch must be an object");
}

/**
 * Checks what the tool says it verified against what the platform sent: a claim of identity but `picture` must be one that the
 * Start Proctoring message carried, with the same value, since verification confirms a value of the platform; a `picture` is one
 * that the tool took, so it is an `https` URL and not the platform's (Proctoring Services 1.0 sections 3.3 and 4.3.2.1).
 */
function checkVerifiedUser(value: unknown, sent: Readonly<Record<string, unknown>>): void {
  checkRecord(value, "The verified user must be an object");
  checkProperties(value, "The verified user", IDENTITY_PROPERTIES);
  for (const name of IDENTITY_TEXT) {
    if (value[name] !== undefined) checkString(value[name], `The verified ${name}`);
  }
  if (value.emailVerified !== undefined && typeof value.emailVerified !== "boolean") {
    throw new DataError(`The verified emailVerified must be a boolean, found ${describe(value.emailVerified)}.`);
  }
  for (const name of [...IDENTITY_TEXT, "emailVerified"]) {
    if (value[name] !== undefined && value[name] !== sent[name]) {
      throw new DataError(
        `The verified ${name} must be the one that the Start Proctoring message gave, ${describe(sent[name])}, found ${describe(value[name])}: a claim that the tool did not verify as the platform's is left out.`,
      );
    }
  }
  if (value.picture !== undefined) {
    checkHttpsUrl(value.picture, "The verified picture");
    if (value.picture === sent.picture) {
      throw new DataError("The verified picture must be one that the tool took, not the picture of the platform.");
    }
  }
}

/** Checks what the host passes beside the launch. */
function checkInput(value: unknown, launch: StartProctoringMessage): asserts value is StartAssessmentInput {
  checkRecord(value, "The input must be an object");
  checkProperties(value, "The input of a Start Assessment message", INPUT_PROPERTIES);
  if (value.endAssessmentReturn !== undefined && typeof value.endAssessmentReturn !== "boolean") {
    throw new DataError(
      `The endAssessmentReturn of the input must be a boolean, found ${describe(value.endAssessmentReturn)}.`,
    );
  }
  if (value.verifiedUser !== undefined) checkVerifiedUser(value.verifiedUser, { ...launch.user });
}

/**
 * Sends the candidate back to the platform to start the assessment: signs the Start Assessment message and returns the page that
 * posts it to the `start_assessment_url` of the Start Proctoring message (Proctoring Services 1.0 sections 3.3 and 4.3).
 *
 * @remarks
 * The tool calls it only when the assessment may proceed; when it may not, it sends the browser to the `return_url` of the launch
 * presentation with `lti_errormsg` instead. The message copies the `session_data`, the resource link and the attempt number of
 * the Start Proctoring message unchanged, carries the claims of identity that the tool verified and `end_assessment_return` when
 * set, and is signed as every message of the tool: `iss` the client, `aud` the platform, a `nonce`, and an expiry five minutes
 * after `iat`. The page must load in the browser of the Start Proctoring message, since the platform binds the session data to
 * that session.
 *
 * @see {@link https://www.imsglobal.org/spec/proctoring/v1p0 | Proctoring Services 1.0}
 * @param launch - The Start Proctoring message that `ltiLaunch` returned.
 * @param input - The claims that the tool verified, and whether it wants the End Assessment message.
 * @param options - The registrations of the tool and its clock.
 * @returns The page to send to the browser.
 * @throws `DataError` when an argument has the wrong type, or a verified claim is not one that the platform sent with that value,
 * or the verified picture is the platform's.
 * @throws `LtiError` (`platform-unknown`, `deployment-unknown`) when the registration is gone or no longer lists the
 * deployment of the launch.
 * @throws The error of the signer when it fails, and the `reason` of `options.signal` when it aborts.
 */
export async function createStartAssessmentPage(
  launch: StartProctoringMessage,
  input: StartAssessmentInput,
  options: ToolOptions,
): Promise<HttpResponse> {
  checkToolOptions(options);
  checkLaunch(launch);
  checkInput(input, launch);
  const registration = await findDeployment(options, launch);
  const message = {
    messageType: "LtiStartAssessment",
    issuer: launch.issuer,
    clientId: launch.clientId,
    deploymentId: launch.deploymentId,
    version: LTI_VERSION,
    sessionData: launch.sessionData,
    resourceLink: launch.resourceLink,
    attemptNumber: launch.attemptNumber,
    endAssessmentReturn: input.endAssessmentReturn === true,
    ...(input.verifiedUser === undefined ? {} : { verifiedUser: input.verifiedUser }),
  } as const;
  return postToolMessage(message, registration, launch.startAssessmentUrl, options);
}
