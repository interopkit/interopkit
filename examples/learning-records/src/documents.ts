import type { DocumentScope, DocumentTarget, LrsDocument, Person } from "@interopkit/learning-records";
import type { AgentStore, DocumentStore } from "@interopkit/learning-records/store";

/** Whether a document's key is in a scope: every property that the scope has is the key's. */
function inScope(key: DocumentTarget, scope: DocumentScope): boolean {
  const properties: Readonly<Record<string, unknown>> = key;
  return (
    key.resource === scope.resource &&
    Object.entries(scope).every(([name, value]) => JSON.stringify(properties[name]) === JSON.stringify(value))
  );
}

/** The ids of a document: the state id or the profile id. */
function idOf(key: DocumentTarget): string {
  return key.resource === "state" ? key.stateId : key.profileId;
}

/**
 * Keeps the State and profile documents in memory. A key is the JSON of the target, which the handler writes in one form for
 * one document. Every method runs to its end before another starts, so each is a compare-and-set as the port asks.
 */
export function createMemoryDocuments(): DocumentStore {
  const kept = new Map<string, { readonly key: DocumentTarget; readonly document: LrsDocument }>();
  return {
    async get(key) {
      return kept.get(JSON.stringify(key))?.document;
    },
    async write(key, document, condition) {
      const id = JSON.stringify(key);
      const current = kept.get(id)?.document;
      if ("ifMatch" in condition && current?.etag !== condition.ifMatch) return "precondition-failed";
      if ("ifNoneMatch" in condition && current !== undefined) return "precondition-failed";
      if ("none" in condition && current !== undefined) return "exists";
      kept.set(id, { key, document });
      return "written";
    },
    async delete(key, condition) {
      const id = JSON.stringify(key);
      const current = kept.get(id)?.document;
      if (current === undefined) return "absent";
      if (current.etag !== condition.ifMatch) return "precondition-failed";
      kept.delete(id);
      return "deleted";
    },
    async list(scope, since) {
      const after = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since);
      return [...kept.values()]
        .filter(({ key, document }) => inScope(key, scope) && Date.parse(document.updated) > after)
        .map(({ key }) => idOf(key));
    },
    async deleteAll(scope) {
      for (const [id, { key }] of kept) if (inScope(key, scope)) kept.delete(id);
    },
  };
}

/** A person that the campus knows by more than one identifier. */
export interface Directory {
  readonly [mbox: string]: Person;
}

/**
 * An `AgentStore` over a directory of people by their `mbox`. An Agent that the directory does not know is answered with what the
 * LRS knows of it: its own identifiers, as the standard asks.
 */
export function createDirectory(people: Directory): AgentStore {
  return {
    async person(agent) {
      const known = agent.mbox === undefined ? undefined : people[agent.mbox];
      if (known !== undefined) return known;
      return {
        objectType: "Person",
        ...(agent.name === undefined ? {} : { name: [agent.name] }),
        ...(agent.mbox === undefined ? {} : { mbox: [agent.mbox] }),
        ...(agent.mbox_sha1sum === undefined ? {} : { mbox_sha1sum: [agent.mbox_sha1sum] }),
        ...(agent.openid === undefined ? {} : { openid: [agent.openid] }),
        ...(agent.account === undefined ? {} : { account: [agent.account] }),
      };
    },
  };
}
