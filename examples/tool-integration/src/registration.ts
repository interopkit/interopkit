import type { ToolConfiguration } from "@interopkit/tool-integration";
import {
  type RegisteredTool,
  type RegistrationGrant,
  type RegistrationStore,
  type ToolRegistration,
  toToolRegistration,
} from "@interopkit/tool-integration/platform";

/** The registrations of the platform in memory: those that wait for review, and the tools that its administrator activated. */
export interface Registrations {
  /** The store behind Dynamic Registration. */
  readonly store: RegistrationStore;
  /** Activates a registered tool with what the administrator grants, so that the platform launches it. */
  activate(clientId: string, grant: RegistrationGrant): ToolRegistration;
  /** Returns the activated tool of a client identifier, which the platform's lookup of tools reads. */
  active(clientId: string): ToolRegistration | undefined;
}

/**
 * Creates the registrations in memory. A real host keeps them in its database, shows the pending ones to an administrator, caps
 * their number when it opens registration to anyone, and keeps an update pending until the administrator accepts it.
 */
export function createRegistrations(): Registrations {
  const registered = new Map<string, RegisteredTool>();
  const activated = new Map<string, ToolRegistration>();
  const store: RegistrationStore = {
    async register(configuration: ToolConfiguration) {
      const tool = { clientId: `registered-tool-${registered.size + 1}`, configuration };
      registered.set(tool.clientId, tool);
      return tool;
    },
    async get(clientId) {
      return registered.get(clientId);
    },
    async update(clientId, configuration) {
      // The change waits for the administrator: the answer shows it, and the launches keep the activated registration.
      return registered.has(clientId) ? { clientId, configuration } : undefined;
    },
  };
  return {
    store,
    activate(clientId, grant) {
      const tool = registered.get(clientId);
      if (tool === undefined) throw new Error(`No tool registered as ${clientId}.`);
      const registration = toToolRegistration(tool, grant);
      activated.set(clientId, registration);
      return registration;
    },
    active: (clientId) => activated.get(clientId),
  };
}
