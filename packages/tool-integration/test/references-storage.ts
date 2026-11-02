import type {
  LTIClient,
  LTIDeployment,
  LTIDynamicRegistrationSession,
  LTILaunchConfig,
  LTISession,
  LTIStorage,
} from "@lti-tool/core";

/**
 * The storage that `@lti-tool/core` takes as a port, in memory: its clients with their deployments, its sessions, the nonces it
 * issued, and the sessions of Dynamic Registration. A nonce is valid once and before it expires.
 */
export function createMemoryStorage(): LTIStorage & {
  readonly clients: Map<string, LTIClient>;
  readonly nonces: Map<string, { readonly expiresAt: Date; used: boolean }>;
} {
  const clients = new Map<string, LTIClient>();
  const sessions = new Map<string, LTISession>();
  const nonces = new Map<string, { readonly expiresAt: Date; used: boolean }>();
  const registrations = new Map<string, LTIDynamicRegistrationSession>();
  const launchConfigs: LTILaunchConfig[] = [];
  let counter = 0;
  const next = (prefix: string) => `${prefix}-${++counter}`;
  const clientOf = (id: string): LTIClient | undefined =>
    clients.get(id) ?? [...clients.values()].find((client) => client.clientId === id);
  return {
    clients,
    nonces,
    listClients: async () => [...clients.values()].map(({ deployments: _deployments, ...client }) => client),
    getClientById: async (id) => clientOf(id),
    addClient: async (client) => {
      const id = next("client");
      clients.set(id, { ...client, id, deployments: [] });
      return id;
    },
    updateClient: async (id, change) => {
      const client = clientOf(id);
      if (client !== undefined) clients.set(client.id, { ...client, ...change });
    },
    deleteClient: async (id) => void clients.delete(id),
    listDeployments: async (id) => clientOf(id)?.deployments ?? [],
    getDeployment: async (id, deploymentId) =>
      clientOf(id)?.deployments.find((deployment) => deployment.deploymentId === deploymentId),
    addDeployment: async (id, deployment: Omit<LTIDeployment, "id">) => {
      const client = clientOf(id);
      const key = next("deployment");
      client?.deployments.push({ ...deployment, id: key });
      return key;
    },
    updateDeployment: async () => undefined,
    deleteDeployment: async () => undefined,
    getSession: async (id) => sessions.get(id),
    addSession: async (session) => {
      sessions.set(session.id, session);
      return session.id;
    },
    storeNonce: async (nonce, expiresAt) => void nonces.set(nonce, { expiresAt, used: false }),
    validateNonce: async (nonce) => {
      const entry = nonces.get(nonce);
      if (entry === undefined || entry.used || entry.expiresAt.getTime() < Date.now()) return false;
      entry.used = true;
      return true;
    },
    getLaunchConfig: async (iss, clientId, deploymentId) => {
      const saved = launchConfigs.find(
        (config) => config.iss === iss && config.clientId === clientId && config.deploymentId === deploymentId,
      );
      if (saved !== undefined) return saved;
      const client = [...clients.values()].find(
        (candidate) => candidate.iss === iss && candidate.clientId === clientId,
      );
      if (client?.deployments.some((deployment) => deployment.deploymentId === deploymentId) !== true) return undefined;
      return {
        iss,
        clientId,
        deploymentId,
        authUrl: client.authUrl,
        tokenUrl: client.tokenUrl,
        jwksUrl: client.jwksUrl,
      };
    },
    saveLaunchConfig: async (config) => void launchConfigs.push(config),
    setRegistrationSession: async (id, session) => void registrations.set(id, session),
    getRegistrationSession: async (id) => registrations.get(id),
    deleteRegistrationSession: async (id) => void registrations.delete(id),
  };
}
