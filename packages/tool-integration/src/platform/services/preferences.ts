import { DataError } from "@interopkit/core";
import { buildJsonResponse, type HttpResponse } from "@interopkit/core/http";
import { type MessageServices, SCOPES } from "../../protocol/index.js";
import {
  PREFERENCES_BASE_PATH,
  PREFERENCES_MEDIA_TYPE,
  readPreferencesQuery,
  readPreferencesRecord,
} from "../../protocol/internal.js";
import { notFound, refusal } from "../answers.js";
import type { PreferencesStore } from "../ports.js";
import { askStore, type ClaimRequest, fromStore, type Service, type ServiceRequest } from "./service.js";

/** The path of the one endpoint of the connector that LTI makes available (AfA PNP Connector 1.0, overview). */
const RECORD_PATH = `${PREFERENCES_BASE_PATH}/users/{user}/activities/{activity}/afapnprecords`;

type Call = ServiceRequest<PreferencesStore>;

/**
 * GET of the record of a user for an activity (AfA PNP Connector 1.0). The only parameter is `fields`, the members that the answer
 * holds and no others: the library drops the rest of what the store gave.
 */
async function getRecord(call: Call): Promise<HttpResponse> {
  const { url, store, caller } = call;
  const user = call.params.user ?? "";
  const activity = call.params.activity ?? "";
  let fields: readonly string[] | undefined;
  try {
    ({ fields } = readPreferencesQuery(url.searchParams));
  } catch (error) {
    if (error instanceof DataError) return refusal(400, "invalid_request", error.message);
    throw error;
  }
  const found = await askStore(call, (options) => store.record(caller, user, activity, fields, options));
  if (found === undefined) return notFound();
  const record = fromStore("PreferencesStore.record", () => readPreferencesRecord(found));
  const body =
    fields === undefined
      ? record
      : Object.fromEntries(Object.entries(record).filter(([name]) => fields.includes(name)));
  return buildJsonResponse(200, body, {}, PREFERENCES_MEDIA_TYPE);
}

/**
 * Writes the claim of the AfA PNP Connector (AfA PNP Connector 1.0, claims in LTI messages) into the services of a message that
 * asks for it: the host, the activities that have a record and the scopes that the registration grants. The claim needs at least
 * one scope, so a tool whose registration grants none is not offered it.
 */
function preferencesClaim({ message, granted, origin }: ClaimRequest): MessageServices {
  const asked = message.services?.preferences;
  if (asked === undefined || granted.length === 0) return {};
  return { preferences: { hostUrl: origin, activityIds: [...asked.activityIds], scopes: granted } };
}

/** The AfA PNP Connector over the host's `PreferencesStore`. */
export const PREFERENCES: Service<"preferences"> = {
  store: "preferences",
  scopes: [SCOPES.preferencesRecordReadonly],
  claim: preferencesClaim,
  routes: [
    {
      path: RECORD_PATH,
      methods: { GET: { scopes: [SCOPES.preferencesRecordReadonly], uses: "record", handle: getRecord } },
    },
  ],
};
