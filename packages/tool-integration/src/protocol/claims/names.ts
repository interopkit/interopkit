const CORE = "https://purl.imsglobal.org/spec/lti/claim";
const DEEP_LINKING = "https://purl.imsglobal.org/spec/lti-dl/claim";
const PROCTORING = "https://purl.imsglobal.org/spec/lti-ap/claim";

/**
 * The names of the claims of the messages of LTI, by the URI that names each. The claims of the Security Framework
 * (`iss`, `aud`, `sub`, `exp`, `iat`, `nonce`, `azp`) and the identity claims of OpenID Connect are named as they are.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/core/lti-spec | LTI 1.3 Core, section 5}
 */
export const CLAIM = {
  messageType: `${CORE}/message_type`,
  version: `${CORE}/version`,
  deploymentId: `${CORE}/deployment_id`,
  targetLinkUri: `${CORE}/target_link_uri`,
  resourceLink: `${CORE}/resource_link`,
  roles: `${CORE}/roles`,
  roleScopeMentor: `${CORE}/role_scope_mentor`,
  actualUser: `${CORE}/actual_user`,
  forUser: `${CORE}/for_user`,
  context: `${CORE}/context`,
  organization: `${CORE}/organization`,
  platformInstance: `${CORE}/tool_platform`,
  launchPresentation: `${CORE}/launch_presentation`,
  lis: `${CORE}/lis`,
  custom: `${CORE}/custom`,
  migration: `${CORE}/lti1p1`,
  deepLinkingSettings: `${DEEP_LINKING}/deep_linking_settings`,
  contentItems: `${DEEP_LINKING}/content_items`,
  data: `${DEEP_LINKING}/data`,
  message: `${DEEP_LINKING}/msg`,
  log: `${DEEP_LINKING}/log`,
  errorMessage: `${DEEP_LINKING}/errormsg`,
  errorLog: `${DEEP_LINKING}/errorlog`,
  agsEndpoint: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint",
  namesRoleService: "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice",
  groupsService: "https://purl.imsglobal.org/spec/lti-gs/claim/groupsservice",
  preferencesService: "https://purl.imsglobal.org/spec/lti-afapnp/claim/afapnp-endpoint-service",
  attemptNumber: `${PROCTORING}/attempt_number`,
  startAssessmentUrl: `${PROCTORING}/start_assessment_url`,
  sessionData: `${PROCTORING}/session_data`,
  assessmentControl: `${PROCTORING}/acs`,
  proctoringSettings: `${PROCTORING}/proctoring_settings`,
  endAssessmentReturn: `${PROCTORING}/end_assessment_return`,
  verifiedUser: `${PROCTORING}/verified_user`,
  proctoringErrorMessage: `${PROCTORING}/errormsg`,
  proctoringErrorLog: `${PROCTORING}/errorlog`,
} as const;
