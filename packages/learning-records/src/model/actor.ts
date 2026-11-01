/** A user account on an existing system, such as an LMS or an intranet (4.2.2.1). */
export interface Account {
  /** The canonical home page of the system that the account is on, an IRL. */
  readonly homePage: string;
  /** The unique id or name that is used to log in to the account. */
  readonly name: string;
}

/**
 * The properties of which exactly one identifies an Agent or an identified Group (4.2.2.1). Nothing in the type keeps a value
 * from having none or several: `readStatement` refuses both.
 */
export interface InverseFunctionalIdentifiers {
  /** The address of the Agent as a `mailto` IRI: `mailto:` and one email address. */
  readonly mbox?: string;
  /** The SHA-1 hash of a `mailto` IRI, as hexadecimal digits. `mboxSha1sum` computes it. */
  readonly mbox_sha1sum?: string;
  /** An OpenID that uniquely identifies the Agent, a URI. */
  readonly openid?: string;
  /** A user account on an existing system. */
  readonly account?: Account;
}

/** A person or a system that does something, identified by exactly one of `mbox`, `mbox_sha1sum`, `openid` and `account` (4.2.2.1). */
export interface Agent extends InverseFunctionalIdentifiers {
  /** The type of the object: `Agent`, or absent. It is required when the Agent is the Object of a Statement. */
  readonly objectType?: "Agent";
  /** The full name of the Agent. */
  readonly name?: string;
}

/** An Agent as the Object of a Statement, where `objectType` is required (4.2.2.3). */
export interface AgentObject extends Agent {
  /** The type of the object. */
  readonly objectType: "Agent";
}

/**
 * A set of Agents (4.2.2.1). An identified Group has exactly one of `mbox`, `mbox_sha1sum`, `openid` and `account`, and
 * may list its members. An anonymous Group has none of them, and lists its members.
 */
export interface Group extends InverseFunctionalIdentifiers {
  /** The type of the object. */
  readonly objectType: "Group";
  /** The name of the Group. */
  readonly name?: string;
  /** The members, an unordered list of Agents. A Group cannot be a member. It is required for an anonymous Group. */
  readonly member?: readonly Agent[];
}

/** Whom a Statement is about: an Agent or a Group (4.2.2.1). */
export type Actor = Agent | Group;
