import {
  type Achievement,
  buildAchievementCredential,
  type ContextLoader,
  type IssuableCredential,
  type Profile,
} from "@interopkit/achievement-credentials";
import { addProof } from "@interopkit/achievement-credentials/data-integrity";
import { signCredentialJwt } from "@interopkit/achievement-credentials/jwt";
import { handleRefreshRequest } from "@interopkit/achievement-credentials/refresh";
import type { Clock, Random } from "@interopkit/core";
import { buildJsonResponse, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import type { SigningKey } from "./keys.ts";
import { createStatusLists, dateTimeOf, type StatusEntry } from "./status-lists.ts";

/** What the university is built from. */
export interface UniversityConfig {
  /** The address of the university's registrar, without a trailing slash: the issuer, the lists and the refresh service are below it. */
  readonly origin: string;
  /** Gives the time that credentials are valid from, and that proofs are made at. */
  readonly clock: Clock;
  /** Picks the place of a credential in a status list. */
  readonly random: Random;
  /** Returns the contexts of a credential with a Data Integrity proof. */
  readonly contexts: ContextLoader;
  /** The key that signs JWTs and status lists (P-256), and the key that signs Data Integrity proofs (Ed25519). */
  readonly keys: { readonly jwt: SigningKey; readonly proof: SigningKey };
}

/** A credential to award. */
interface Award {
  /** The address of the credential. */
  readonly id: string;
  /** The name of the credential, for a wallet to show. */
  readonly name: string;
  /** The `id` of the earner, such as a DID. */
  readonly learner: string;
  /** The achievement that was earned. */
  readonly achievement: Achievement;
  /** How the credential is secured: a compact JWS, or a Data Integrity proof. */
  readonly proof: "jwt" | "data-integrity";
}

/** A credential as the university gives it to the earner. */
type Secured = string | IssuableCredential;

/** The registrar of a university: it awards credentials, revokes and reissues them, and publishes what a verifier needs. */
export interface University {
  /** The `id` of the issuer. */
  readonly issuer: string;
  /** Answers the requests that a verifier makes of the registrar: the keys of the issuer, a status list, a refresh service. */
  handle(request: HttpRequest): Promise<HttpResponse>;
  /** Awards a credential, with an entry in the revocation list and a refresh service, and secures it. */
  award(award: Award): Promise<Secured>;
  /** Revokes a credential it awarded. */
  revoke(id: string): void;
  /** Replaces the credential it awarded with a new version with another name, valid from now. The refresh service gives it. */
  reissue(id: string, name: string): Promise<void>;
}

/** What the registrar keeps of a credential: its place in the list, the award, and the version that its refresh service gives. */
interface Kept {
  readonly award: Award;
  readonly entry: StatusEntry;
  readonly refreshPath: string;
  current: Secured;
}

/** Opens the registrar of a university. */
export function createUniversity(config: UniversityConfig): University {
  const { origin, clock, random, contexts, keys } = config;
  const issuer = `${origin}/issuers/1`;
  const jwtMethod = `${issuer}#jwt-key`;
  const proofMethod = `${issuer}#proof-key`;
  const profile: Profile = { id: issuer, type: ["Profile"], name: "Example University", url: origin };
  const controller = {
    id: issuer,
    verificationMethod: [
      { id: jwtMethod, type: "JsonWebKey", controller: issuer, publicKeyJwk: keys.jwt.publicKeyJwk },
      { id: proofMethod, type: "Multikey", controller: issuer, publicKeyMultibase: keys.proof.multikey },
    ],
    assertionMethod: [jwtMethod, proofMethod],
  };
  const jwtSigner = keys.jwt.signer(jwtMethod);
  const proofSigner = keys.proof.signer(proofMethod);
  const lists = createStatusLists({ issuer, base: `${origin}/status`, clock, random });
  const kept = new Map<string, Kept>();
  const byRefreshPath = new Map<string, Kept>();

  /** Writes the credential of an award, as of now, and secures it. */
  async function secure(award: Award, entry: StatusEntry, refreshPath: string, name: string): Promise<Secured> {
    const credential = buildAchievementCredential({
      id: award.id,
      issuer: profile,
      validFrom: dateTimeOf(clock.now()),
      name,
      subject: { id: award.learner },
      achievement: award.achievement,
      credentialStatus: entry,
      refreshService: { id: `${origin}/refresh/${refreshPath}`, type: "1EdTechCredentialRefresh" },
    });
    return award.proof === "jwt"
      ? await signCredentialJwt(credential, jwtSigner, { kid: jwtMethod })
      : await addProof(credential, proofSigner, { contexts, clock });
  }

  return {
    issuer,
    async handle(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/issuers/1") return buildJsonResponse(200, controller);
      if (pathname.startsWith("/refresh/")) {
        return await handleRefreshRequest(request, {
          refresh: async (id) => {
            const { current } = byRefreshPath.get(id) ?? {};
            return typeof current === "object" ? { ...current } : current;
          },
        });
      }
      const list = await lists.credentialAt(`${origin}${pathname}`, jwtSigner, { proof: "jwt", clock });
      return typeof list === "string"
        ? { status: 200, headers: { "content-type": "application/jwt" }, body: list }
        : { status: 404, headers: {}, body: "" };
    },
    async award(award) {
      const entry = lists.allocate("revocation");
      const refreshPath = String(kept.size + 1);
      const secured = await secure(award, entry, refreshPath, award.name);
      const held = { award, entry, refreshPath, current: secured };
      kept.set(award.id, held);
      byRefreshPath.set(refreshPath, held);
      return secured;
    },
    revoke(id) {
      const held = kept.get(id);
      if (held === undefined) throw new Error(`The university awarded no credential ${id}.`);
      lists.setStatus(held.entry, true);
    },
    async reissue(id, name) {
      const held = kept.get(id);
      if (held === undefined) throw new Error(`The university awarded no credential ${id}.`);
      held.current = await secure(held.award, held.entry, held.refreshPath, name);
    },
  };
}
