/**
 * The scopes of the services that the packages model, by the URI that names each.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/services/assignments_grades/assignment-grade-services-spec | LTI AGS 2.0, sections 3.2 to 3.4}
 */
export const SCOPES = {
  /** Manages the line items of a context (AGS). */
  lineitem: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
  /** Reads the line items of a context (AGS). */
  lineitemReadonly: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
  /** Reads the results of a line item (AGS). */
  resultReadonly: "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
  /** Publishes the scores of a line item (AGS). */
  score: "https://purl.imsglobal.org/spec/lti-ags/scope/score",
  /** Reads the members of a context (Names and Role Provisioning 2.0). */
  contextMembershipReadonly: "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",
  /** Reads the groups and group sets of a context (Context Groups 1.0). */
  contextGroupReadonly: "https://purl.imsglobal.org/spec/lti-gs/scope/contextgroup.readonly",
  /** Reads the personal needs and preferences record of a user for an activity (AfA PNP Connector 1.0). */
  preferencesRecordReadonly: "https://purl.imsglobal.org/spec/afapnp/v1p0/scope/afapnprecord.lti.readonly",
  /** Controls an assessment attempt (Proctoring Services 1.0). */
  assessmentControl: "https://purl.imsglobal.org/spec/lti-ap/scope/control.all",
  /** Reads the registration of a tool (Dynamic Registration 1.0). */
  registrationReadonly: "https://purl.imsglobal.org/spec/lti-reg/scope/registration.readonly",
  /** Reads and updates the registration of a tool (Dynamic Registration 1.0). */
  registration: "https://purl.imsglobal.org/spec/lti-reg/scope/registration",
} as const;
