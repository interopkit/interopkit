import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { SCOPES } from "../../protocol/index.js";
import { notFound, refusal } from "../answers.js";
import type { RegistrationStore } from "../ports.js";
import {
  admitConfiguration,
  readRegistrationBody,
  registrationAnswer,
  storedRefusal,
  storedRegistration,
} from "../registration-flow/tool-configuration.js";
import { askStore, type Service, type ServiceRequest } from "./service.js";

const CLIENT_PATH = "/registration/{client}";

// `get` and `update` are optional, and a method of the route is served only when the store has it, so their optional calls
// always reach the store.
type Call = ServiceRequest<RegistrationStore>;

/** The client of the path, when it is the caller's: a tool reads and changes its own registration and no other. */
function ownClient(call: Call): string | undefined {
  const client = call.params.client ?? "";
  return client === call.caller.clientId ? client : undefined;
}

/** GET of the registration of the calling tool (Dynamic Registration 1.0 section 4.1), in the form of the registration response. */
async function getRegistration(call: Call): Promise<HttpResponse> {
  const client = ownClient(call);
  if (client === undefined) return notFound();
  const found = await askStore(call, (options) => call.store.get?.(client, options));
  if (found === undefined) return notFound();
  const tool = storedRegistration("RegistrationStore.get", found);
  if (tool.clientId !== client) {
    throw new DataError(
      `The answer of RegistrationStore.get breaks its contract: it is the registration of ${tool.clientId}.`,
    );
  }
  return registrationAnswer(200, tool, call.settings);
}

/**
 * PUT of a new configuration of the calling tool (Dynamic Registration 1.0 section 4.1): read and held to the platform's rules as a
 * registration is, then given to the store, which may keep it pending until an administrator accepts it. The answer shows what
 * the store recorded, with the same client identifier.
 */
async function putRegistration(call: Call): Promise<HttpResponse> {
  const client = ownClient(call);
  if (client === undefined) return notFound();
  const body = readRegistrationBody(call.request, call.settings, client);
  if ("status" in body) return body;
  const admitted = admitConfiguration(body.value, call.settings, call.offered);
  if ("status" in admitted) return admitted;
  const label = "RegistrationStore.update";
  const updated = await askStore(call, (options) => call.store.update?.(client, admitted.value, options));
  if (updated === undefined) return notFound();
  const reason = storedRefusal(label, updated);
  if (reason !== undefined) return refusal(400, "invalid_client_metadata", reason);
  const tool = storedRegistration(label, updated);
  // A platform must never change the client identifier of a registration (Dynamic Registration 1.0 section 4.1).
  if (tool.clientId !== client) {
    throw new DataError(
      `The answer of ${label} breaks its contract: it changed the client identifier to ${tool.clientId}.`,
    );
  }
  return registrationAnswer(200, tool, call.settings);
}

/**
 * The client configuration endpoint of Dynamic Registration over the host's `RegistrationStore`, behind an access token with a
 * scope of `lti-reg` (Dynamic Registration 1.0 section 4.2). The registration endpoint and the OpenID configuration, which need no
 * access token, are routes of the handler.
 */
export const REGISTRATIONS: Service<"registrations"> = {
  store: "registrations",
  scopes: [SCOPES.registrationReadonly, SCOPES.registration],
  claim: () => ({}),
  routes: [
    {
      path: CLIENT_PATH,
      methods: {
        GET: { scopes: [SCOPES.registrationReadonly, SCOPES.registration], uses: "get", handle: getRegistration },
        PUT: { scopes: [SCOPES.registration], uses: "update", handle: putRegistration },
      },
    },
  ],
};
