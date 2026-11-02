import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createContextLoader } from "@interopkit/achievement-credentials/data-integrity";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { type Fetch, SYSTEM_CLOCK, SYSTEM_RANDOM } from "@interopkit/core";
import { createSigningKey, type SigningAlgorithm } from "./src/keys.ts";
import { serve } from "./src/server.ts";
import type { StatusPurpose } from "./src/status-lists.ts";
import { createVcApi, type VcApiIssuer } from "./src/vc-api.ts";

/**
 * Starts the VC-API service on the loopback address with TLS, for a conformance suite of the W3C or a person with `curl`, and
 * prints one line of JSON: its address and the issuers it serves. The environment says where it listens and what it trusts:
 * `VC_API_PORT` (a free port by default), `VC_API_TLS_KEY` and `VC_API_TLS_CERT` (the paths of a key and a self-signed
 * certificate for 127.0.0.1) and `VC_API_CONTEXTS` (the path of a JSON file that maps the address of each context to its document).
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Set ${name}: the service has no default for it.`);
  return value;
}

const tls = {
  key: readFileSync(required("VC_API_TLS_KEY"), "utf8"),
  cert: readFileSync(required("VC_API_TLS_CERT"), "utf8"),
};
const documents = new Map(
  Object.entries(JSON.parse(readFileSync(required("VC_API_CONTEXTS"), "utf8")) as Record<string, unknown>),
);

/**
 * A `fetch` that trusts the certificate of the service and no other, to reach the status lists that the service serves. A host
 * that fetches from the network passes a `fetch` that refuses private addresses after resolution.
 */
const fetchTrusting: Fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      { method: init.method, headers: init.headers, ca: tls.cert, signal: init.signal },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
              headers: response.headers as HeadersInit,
            }),
          ),
        );
      },
    );
    request.on("error", reject);
    request.end(init.body);
  });

/** The issuers: a key of each kind, and a list of each purpose. */
const KINDS: readonly (readonly [string, SigningAlgorithm, StatusPurpose | undefined])[] = [
  ["eddsa", "EdDSA", undefined],
  ["ecdsa-sd", "ES256", undefined],
  ["revocable", "EdDSA", "revocation"],
  ["suspendable", "EdDSA", "suspension"],
];
const issuers: Record<string, VcApiIssuer> = {};
for (const [name, algorithm, status] of KINDS) {
  const key = await createSigningKey(algorithm);
  issuers[name] = {
    id: key.did,
    algorithm,
    signer: key.signer(`${key.did}#${key.multikey}`),
    ...(status === undefined ? {} : { status }),
  };
}

// The documents are the downloads that `pnpm schemas` checked against the hashes of its lock, so a pin would repeat that check.
const contexts = createContextLoader({ documents, allowUnknown: true });
const { server, url } = await serve((request) => api.handle(request), {
  port: Number(process.env.VC_API_PORT ?? 0),
  tls,
});
const api = createVcApi({
  origin: url,
  issuers,
  random: SYSTEM_RANDOM,
  verify: { keys: createKeyResolver({ clock: SYSTEM_CLOCK }), clock: SYSTEM_CLOCK, contexts, fetch: fetchTrusting },
});
console.log(
  JSON.stringify({
    origin: url,
    issuers: Object.fromEntries(Object.entries(issuers).map(([name, issuer]) => [name, issuer.id])),
  }),
);
process.on("SIGTERM", () => server.close());
