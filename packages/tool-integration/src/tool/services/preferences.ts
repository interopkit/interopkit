import type { CallOptions } from "@interopkit/core";
import { checkHttpsUrl, checkNonEmptyString, checkRecord } from "@interopkit/core/checks";
import { type PreferencesClaim, type PreferencesQuery, type PreferencesRecord, SCOPES } from "../../protocol/index.js";
import {
  PREFERENCES_BASE_PATH,
  PREFERENCES_MEDIA_TYPE,
  readPreferencesRecord,
  writePreferencesQuery,
} from "../../protocol/internal.js";
import type { ServiceAccess } from "./access.js";

const TRAILING_SLASH = /\/$/u;
/** The status of a record that the platform does not have or does not share. */
const NOT_FOUND = 404;

/** The client of the AfA PNP Connector (AfA PNP Connector 1.0) of a platform. */
export interface PreferencesClient {
  /**
   * Returns the record of the needs and preferences of a user for an activity, as JSON, or `undefined` when the platform has none
   * or does not share it (404). The host maps the record to its own model.
   *
   * @remarks
   * The URL is the `hostUrl` of the claim with the path that the connector fixes below the host: `/ims/afapnp/v1p0/users/{user}/
   * activities/{activity}/afapnprecords`. The only parameter that the connector permits is `fields`: the members of the record
   * that the answer holds and no others.
   *
   * @param claim - The claim of a launch, `launch.services.preferences`.
   * @param userSourcedId - The user, as the platform identifies them for this service.
   * @param activityId - The activity, one of the `activityIds` of the claim.
   * @param query - The members of the record to ask for; none is all.
   * @throws `DataError` when an argument has the wrong type.
   */
  preferences(
    claim: PreferencesClaim,
    userSourcedId: string,
    activityId: string,
    query?: PreferencesQuery,
    options?: CallOptions,
  ): Promise<PreferencesRecord | undefined>;
}

/** Returns the URL of the record of a user for an activity below the host of a claim, with the query. */
function recordUrl(claim: unknown, userSourcedId: unknown, activityId: unknown, query: PreferencesQuery): string {
  checkRecord(claim, "The claim must be an object");
  checkHttpsUrl(claim.hostUrl, "The host URL of the claim");
  checkNonEmptyString(userSourcedId, "The user");
  checkNonEmptyString(activityId, "The activity");
  const host = claim.hostUrl.replace(TRAILING_SLASH, "");
  const path = `${PREFERENCES_BASE_PATH}/users/${encodeURIComponent(userSourcedId)}/activities/${encodeURIComponent(activityId)}/afapnprecords`;
  const url = new URL(`${host}${path}`);
  for (const [name, value] of writePreferencesQuery(query)) url.searchParams.set(name, value);
  return url.href;
}

/** Makes the client of the preferences over the access to the services of a platform. */
export function preferencesClient(access: ServiceAccess): PreferencesClient {
  return {
    async preferences(claim, userSourcedId, activityId, query, options) {
      const address = recordUrl(claim, userSourcedId, activityId, query ?? {});
      const init = {
        method: "GET",
        scopes: [SCOPES.preferencesRecordReadonly],
        accept: PREFERENCES_MEDIA_TYPE,
        expect: [NOT_FOUND],
      } as const;
      const response = await access.request(address, init, options);
      return response.status === NOT_FOUND
        ? undefined
        : access.read(response, `The preferences record at ${address}`, readPreferencesRecord);
    },
  };
}
