import type { VerifiableCredential } from "@interopkit/achievement-credentials";
import {
  allocateStatusIndex,
  createStatusList,
  issueStatusListCredential,
  type StatusIssueOptions,
  type StatusList,
  setCredentialStatus,
} from "@interopkit/achievement-credentials/status";
import type { Clock, Random, Signer } from "@interopkit/core";

/** What a set entry of a list means. */
export type StatusPurpose = "revocation" | "suspension";

/** The entry that a credential holds to name its place in a list. */
export interface StatusEntry {
  readonly id: string;
  readonly type: "BitstringStatusListEntry";
  readonly statusPurpose: StatusPurpose;
  readonly statusListIndex: string;
  readonly statusListCredential: string;
}

/** What an issuer needs to keep lists. */
export interface StatusListsConfig {
  /** The `id` of the issuer, who issues the list credentials too. */
  readonly issuer: string;
  /** Where the lists are served: a list is at `{base}/{purpose}/1`. */
  readonly base: string;
  /** Gives the time that a list credential is valid from. */
  readonly clock: Clock;
  /** Picks the index of a credential, so that it says nothing of the order of issue. */
  readonly random: Random;
}

/** The lists of one issuer: one for each purpose, held as plain data. */
export interface StatusLists {
  /** Gives a credential a free place in the list of a purpose, and returns the entry that names it. */
  allocate(purpose: StatusPurpose): StatusEntry;
  /** Sets or clears the entry of a credential. */
  setStatus(entry: StatusEntry, set: boolean): void;
  /** Issues the list credential at an address, or returns `undefined` when the issuer keeps no list there. */
  credentialAt(
    address: string,
    signer: Signer,
    options: StatusIssueOptions,
  ): Promise<string | VerifiableCredential | undefined>;
}

/** Writes a time as the `validFrom` of a credential: UTC, with whole seconds. */
export function dateTimeOf(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

/** Keeps the lists of an issuer. */
export function createStatusLists(config: StatusListsConfig): StatusLists {
  const { issuer, base, clock, random } = config;
  const lists = new Map<StatusPurpose, { list: StatusList; readonly used: Set<number> }>();
  const addressOf = (purpose: StatusPurpose): string => `${base}/${purpose}/1`;
  const listOf = (purpose: StatusPurpose) => {
    const held = lists.get(purpose) ?? { list: createStatusList(), used: new Set<number>() };
    lists.set(purpose, held);
    return held;
  };
  return {
    allocate(purpose) {
      const held = listOf(purpose);
      const index = allocateStatusIndex(held.used, { length: held.list.length, random });
      held.used.add(index);
      return {
        id: `${addressOf(purpose)}#${index}`,
        type: "BitstringStatusListEntry",
        statusPurpose: purpose,
        statusListIndex: String(index),
        statusListCredential: addressOf(purpose),
      };
    },
    setStatus(entry, set) {
      const held = listOf(entry.statusPurpose);
      held.list = setCredentialStatus(held.list, Number(entry.statusListIndex), set);
    },
    async credentialAt(address, signer, options) {
      const purpose = (["revocation", "suspension"] as const).find((each) => addressOf(each) === address);
      if (purpose === undefined) return undefined;
      return await issueStatusListCredential(
        { id: address, issuer, validFrom: dateTimeOf(clock.now()), purpose, list: listOf(purpose).list },
        signer,
        options,
      );
    },
  };
}
