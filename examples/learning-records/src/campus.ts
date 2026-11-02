import type { Account, Agent } from "@interopkit/learning-records";
import { deriveStatementId } from "@interopkit/learning-records";

/** The address of the campus LRS, and the path its resources are below. */
export const ORIGIN = "https://lrs.campus.example";

/** The namespace of the ids that the platform derives for its events, so that a resend of an event has the id it had. */
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/** Learners of the campus: one that the directory knows by an email and an account, one that has only an account. */
export const ANA: Agent = { mbox: "mailto:ana@campus.example", name: "Ana" };
export const BUDI: Agent = { account: { homePage: "https://sso.campus.example", name: "budi" }, name: "Budi" };

/** The courses and what they are about. */
export const STATISTICS = "https://campus.example/courses/statistics";
export const SURVEY = "https://campus.example/courses/statistics/survey-1";

/** The verbs that the platform uses, from the registry of ADL. */
export const VERBS = {
  launched: { id: "http://adlnet.gov/expapi/verbs/launched", display: { "en-US": "launched" } },
  answered: { id: "http://adlnet.gov/expapi/verbs/answered", display: { "en-US": "answered" } },
  completed: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "completed" } },
  earned: { id: "https://campus.example/verbs/earned", display: { "en-US": "earned" } },
} as const;

/** The id of the Statement for an event of a learner in a course: the same event has the same id. */
export function idOf(event: string, learner: Agent, at: string): string {
  const who = learner.mbox ?? (learner.account as Account).name;
  return deriveStatementId(NAMESPACE, `${event}|${who}|${at}`);
}

/** The people that the campus directory knows by more than one identifier. */
export const DIRECTORY = {
  [ANA.mbox ?? ""]: {
    objectType: "Person" as const,
    name: ["Ana", "Ana Putri"],
    mbox: ["mailto:ana@campus.example", "mailto:ana.putri@alumni.campus.example"],
    account: [{ homePage: "https://sso.campus.example", name: "ana" }],
  },
};
