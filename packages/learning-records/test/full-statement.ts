import type { Statement } from "../src/index.js";

/** A UUID of version 4 and variant 2, for the identifiers of the fixtures. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * A Statement as an LRS returns it, with every property of every table once: the properties that the LRS sets, an Agent for
 * the actor, an Activity with an interaction for the Object, and a Result, a Context and Attachments with all their
 * properties. It breaks no rule of either role, except that a provider should not send `stored`, `authority` or `version`.
 */
export function fullStatement(): Statement {
  return {
    id: uuid(1),
    actor: { objectType: "Agent", name: "Example Learner", mbox: "mailto:learner@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/answered", display: { "en-US": "answered", "en-GB": "answered" } },
    object: {
      objectType: "Activity",
      id: "https://example.org/activities/quiz-1/question-3",
      definition: {
        name: { "en-US": "Question 3" },
        description: { "en-US": "Which sports are played with a ball?" },
        type: "http://adlnet.gov/expapi/activities/cmi.interaction",
        moreInfo: "https://example.org/activities/quiz-1/question-3/info",
        extensions: { "https://example.org/xapi/extensions/difficulty": 3 },
        interactionType: "choice",
        correctResponsesPattern: ["golf[,]tetris"],
        choices: [
          { id: "golf", description: { "en-US": "Golf Example" } },
          { id: "tetris", description: { "en-US": "Tetris Example" } },
          { id: "facebook", description: { "en-US": "Facebook App" } },
        ],
      },
    },
    result: {
      score: { scaled: 0.8, raw: 8, min: 0, max: 10 },
      success: true,
      completion: true,
      response: "golf[,]tetris",
      duration: "PT1H30M15.25S",
      extensions: { "https://example.org/xapi/extensions/attempts": 2 },
    },
    context: {
      registration: uuid(2),
      instructor: { mbox_sha1sum: "e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90" },
      team: {
        objectType: "Group",
        name: "Team A",
        openid: "https://openid.example.org/teams/a",
        member: [{ account: { homePage: "https://lms.example.org", name: "learner-1" } }],
      },
      contextActivities: {
        parent: [{ id: "https://example.org/activities/quiz-1" }],
        grouping: [{ objectType: "Activity", id: "https://example.org/activities/course-1" }],
        category: [{ id: "https://example.org/profiles/quizzes" }],
        other: [{ id: "https://example.org/activities/resource-9" }],
      },
      contextAgents: [
        {
          objectType: "contextAgent",
          agent: { openid: "https://openid.example.org/people/proctor" },
          relevantTypes: ["https://example.org/xapi/context/proctor"],
        },
      ],
      contextGroups: [
        {
          objectType: "contextGroup",
          group: { objectType: "Group", member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }] },
          relevantTypes: ["https://example.org/xapi/context/study-group"],
        },
      ],
      revision: "2.1",
      platform: "Example LMS",
      language: "en-US",
      statement: { objectType: "StatementRef", id: uuid(3) },
      extensions: { "https://example.org/xapi/extensions/device": "tablet" },
    },
    timestamp: "2024-06-13T18:46:03.250Z",
    stored: "2024-06-13T18:46:04.100Z",
    authority: { name: "Example LMS", account: { homePage: "https://lms.example.org", name: "lrs-client" } },
    version: "2.0.0",
    attachments: [
      {
        usageType: "http://adlnet.gov/expapi/attachments/signature",
        display: { "en-US": "Signature" },
        description: { "en-US": "A test signature" },
        contentType: "application/octet-stream",
        length: 4235,
        sha2: "672fa5fa658017f1b72d65036f13379c6ab05d4ab3b6664908d8acf0b6a0c634",
        fileUrl: "https://example.org/attachments/signature-1",
      },
    ],
  };
}

/** The Statement as a Learning Record Provider writes it: without what the LRS sets. */
export function providerStatement(): Statement {
  const { stored: _stored, authority: _authority, version: _version, ...statement } = fullStatement();
  return statement;
}

/** The smallest Statement: an Actor, a Verb and an Object. */
export function minimalStatement(): Statement {
  return {
    actor: { mbox: "mailto:learner@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
    object: { id: "https://example.org/activities/course-1" },
  };
}

/** A Statement whose Object is a SubStatement, with its own Actor, Verb, Object, Result and Context. */
export function subStatementStatement(): Statement {
  return {
    id: uuid(4),
    actor: { mbox: "mailto:teacher@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/asked" },
    object: {
      objectType: "SubStatement",
      actor: { mbox: "mailto:learner@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
      object: { objectType: "Agent", mbox: "mailto:classmate@example.org" },
      result: { response: "42" },
      context: { contextActivities: { parent: [{ id: "https://example.org/activities/quiz-1" }] } },
      timestamp: "2024-06-13T18:00:00.000Z",
      attachments: [],
    },
    timestamp: "2024-06-13T18:46:03.250Z",
  };
}
