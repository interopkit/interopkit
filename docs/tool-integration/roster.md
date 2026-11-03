# LTI roster services

Names and Role Provisioning 2.0 (NRPS), Context Groups 1.0 and the AfA PNP Connector 1.0 in both roles. In the tool role,
`createServiceClient` reads the members of a context or a resource link, its groups and group sets, and the record of needs and
preferences of a user for an activity. In the platform role, `handlePlatformRequest` serves the same services over the host's
`RosterStore`, `GroupStore` and `PreferencesStore`, and offers each in the claims of a message only when its store is given. The
bodies are the [service models](services.md) that both roles share.

```mermaid
sequenceDiagram
  participant H as Tool host
  participant C as ServiceClient
  participant P as handlePlatformRequest
  participant R as RosterStore, GroupStore, PreferencesStore
  H->>C: members(context_memberships_url, { groups: true })
  C->>P: GET memberships, a token of contextmembership.readonly
  P->>P: token, client and scopes checked again
  P->>R: members(caller, context, { role, resourceLinkId, groups, since, limit, cursor })
  R-->>P: a page, a cursor, a differences token
  P-->>C: the container, Link: next and differences
  H->>C: groups(context_groups_url, { userId })
  C->>P: GET groups?user_id=..., a token of contextgroup.readonly
  H->>C: preferences(claim, user, activity)
  C->>P: GET {host}/ims/afapnp/v1p0/users/{user}/activities/{activity}/afapnprecords
```

| Role     | Function                                                      | Does                                                                                          |
| -------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tool     | `createServiceClient(deployment, options).members(url, query)` | Returns a page of the members of a context or a resource link, with the context and the link to the differences |
| Tool     | `.groups(url, query)`, `.groupSets(url, query)`               | Return a page of the groups of a context, or of a user in it, and a page of its group sets     |
| Tool     | `.preferences(claim, user, activity, query)`                  | Returns the record of a user for an activity as JSON, or `undefined`                           |
| Platform | `handlePlatformRequest(request, options)`                     | With `services.roster`, `services.groups` and `services.preferences`, also serves their routes |

## Quick start

A tool reads the members of a context. The sample serves the platform's token endpoint and the membership service from a `fetch`
that it writes; a real tool passes the `fetch` of its host.

```ts
import { signerFromCryptoKey } from "@interopkit/core";
import { createServiceClient } from "@interopkit/tool-integration/tool";

const keys = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  false,
  ["sign"],
);
const scope = "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
const registration = {
  issuer: "https://lms.example.edu",
  clientId: "962fa4d8-bcbf-49a0-94b2-2de05ad274af",
  deploymentIds: ["07940580-b309-415e-a37c-914d387c1150"],
  authenticationUrl: "https://lms.example.edu/auth",
  jwksUrl: "https://lms.example.edu/jwks",
  accessTokenUrl: "https://lms.example.edu/token",
  redirectUri: "https://tool.example.com/lti/launch",
  signer: signerFromCryptoKey(keys.privateKey, { algorithm: "RS256", keyId: "tool-1" }),
};
const platform = async (url) =>
  url === registration.accessTokenUrl
    ? Response.json({ access_token: "token-1", token_type: "Bearer", expires_in: 3600, scope })
    : Response.json(
        {
          id: "https://lms.example.edu/sections/2923/memberships",
          context: { id: "2923-abc", label: "CPS 435" },
          members: [{ user_id: "0ae836b9", roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"] }],
        },
        { headers: { link: '</sections/2923/memberships?limit=100&p=2>; rel="next"' } },
      );
const client = createServiceClient(
  { issuer: registration.issuer, clientId: registration.clientId, deploymentId: registration.deploymentIds[0] },
  { registration: async () => registration, clock: { now: () => 1_700_000_000_000 }, fetch: platform, scopes: [scope] },
);
const page = await client.members("https://lms.example.edu/sections/2923/memberships");
page.items[0].userId; // => "0ae836b9"
page.context.label; // => "CPS 435"
page.next; // => "https://lms.example.edu/sections/2923/memberships?limit=100&p=2"
```

A whole flow, a platform with a course and a tool that reads it, runs in the [example](../../examples/tool-integration/README.md):
`src/roster.ts` holds the three stores in memory, and `readRoster` of `src/tool.ts` reads the members with their groups, the groups
and sets and the record of a user.

## The tool role

The client takes the URL from the claim of the launch: `launch.services.roster.contextMembershipsUrl`,
`launch.services.groups.contextGroupsUrl` and `contextGroupSetsUrl`, and `launch.services.preferences`. The scopes that it is given
are the ones the platform offered: the claim of NRPS has no list, and its one scope is `contextmembership.readonly`
(`SCOPES.contextMembershipReadonly`). A host keeps one client for each deployment, so that its tokens are reused; the
[grade services guide](grades.md) has the tokens, the URLs a token may go to, the reading of answers and the options.

| Method                                            | Specification | Scope asked for              | Answers                                                       |
| ------------------------------------------------- | ------------- | ---------------------------- | ------------------------------------------------------------- |
| `members(url, query?)`                            | NRPS 2.0      | `contextmembership.readonly` | A `MemberPage`: `items`, `context`, `next`, `differences`     |
| `groups(url, query?)`                             | Groups 2.5.1  | `contextgroup.readonly`      | A `Page<Group>`                                               |
| `groupSets(url, query?)`                          | Groups 2.5.2  | `contextgroup.readonly`      | A `Page<GroupSet>`                                            |
| `preferences(claim, user, activity, query?)`      | PNP 1.0       | `afapnprecord.lti.readonly`  | The record as JSON, or `undefined` for a 404                  |

Each method also takes `{ signal }`.

### Members

A `MemberQuery` has the filters of NRPS and of Context Groups 2.4:

| Property         | Parameter | Meaning                                                                                                |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `role`           | `role`    | Only the members with this role, by its URI or, for a context role, its simple name (`Learner`)         |
| `limit`          | `limit`   | The most members; the platform may return more or fewer. None is the option `pageLimit` (100)            |
| `resourceLinkId` | `rlid`    | The members who can reach this resource link, each with the `message` that its launch would carry      |
| `groups`         | `groups`  | Adds the `groupEnrollments` of each member                                                              |
| `since`          | `since`   | The differences with an earlier read, when the tool has the token and not the link                     |

A page has the members as `Member` values (`userId`, `roles`, `status`, the names, `email`, `lisPersonSourcedId`,
`lti11LegacyUserId`, `message`, `groupEnrollments`), the `context`, and two links on the origin of the request: `next` and
`differences`. Pass either to `members` as it is. A `next` link ends the pages; a `differences` link reads the changes since this
read: the members who joined or changed, in their current state, and the ones who left, with the status `Deleted` (NRPS 2.0,
membership differences). A link to another origin is dropped, so that the token never leaves the platform that answered. A platform
shares only what it has agreed to share beyond `userId`, `roles` and the context (NRPS 2.0, sharing of personal data), so a tool
never relies on another property being there. A 404 is a `ServiceError`: the resource link is not the tool's, or the cursor is gone,
and the tool starts from the first page.

### Groups

`groups(url, { userId, limit })` returns the groups of a context, or only those the user is enrolled in; a group has an `id`, a
`name`, a `tag`, the `setIds` of the sets it belongs to (a group may belong to several, see [spec-gaps](spec-gaps.md)) and `hidden`.
`groupSets(url, { limit })` returns the sets, each with an `id`, a `name`, a `tag` and `hidden`. The `member.groupEnrollments` of
`members(url, { groups: true })` list the groups by `groupId`.

### Preferences

`preferences(claim, userSourcedId, activityId, { fields })` takes the claim of the launch, `launch.services.preferences`, whose
`hostUrl` is the host of the service, and calls `{hostUrl}/ims/afapnp/v1p0/users/{user}/activities/{activity}/afapnprecords`, the
one endpoint of the connector that LTI makes available. The user and the activity are encoded in the path. `fields` lists the
members of the record that the answer holds and no others. The record is JSON and passes through: the host maps it to its own model.

## The platform role

With `services: { roster, groups, preferences }` in its options, `handlePlatformRequest` offers the services whose stores it has:
the token endpoint grants their scopes when the registration does, a message that asks for them carries their claims, and the
routes below are served. Without a store, none of the three exists. The access is the grade services': a bearer token of `/token`,
looked up again on every request, with the scope of the route among those that the registration still grants; the store receives
the caller and the `signal`, and answers `undefined` for what is not the caller's, which is 404.

| Path under `origin`                                                    | Scope              | Store                                                        |
| ---------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `/contexts/{context}/memberships`                                      | `contextmembership.readonly` | `roster.members(caller, context, query)`          |
| `/contexts/{context}/groups`                                           | `contextgroup.readonly`      | `groups.groups(caller, context, query)`           |
| `/contexts/{context}/group-sets`                                       | `contextgroup.readonly`      | `groups.groupSets(caller, context, query)`, when the store has group sets; without it the path names nothing |
| `/ims/afapnp/v1p0/users/{user}/activities/{activity}/afapnprecords`    | `afapnprecord.lti.readonly`  | `preferences.record(caller, user, activity, fields)` |

### The claims

A message offers the services with `services: { roster: true, groups: { sets }, preferences: { activityIds } }`. The roster and
the groups need the `context` of the message, since their URLs lie below it; the connector needs none, since a record is below the
host. The claims:

| Service          | Claim                                                                    | Holds                                                                                          |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| NRPS             | `.../lti-nrps/claim/namesroleservice`                                    | `context_memberships_url`, `service_versions: ["2.0"]`                                          |
| Context Groups   | `.../lti-gs/claim/groupsservice`                                         | `context_groups_url`, `context_group_sets_url` when `sets` is true and the store has `groupSets`, the granted `scope`, `service_versions: ["1.0"]` |
| The connector    | `.../lti-afapnp/claim/afapnp-endpoint-service`                           | `afapnp_endpoint_hosturl` (the platform's origin), `afapnp_activity_ids`, the granted `scopes`  |

The platform builds the URLs from `config.origin` and the identifiers, encoded. The connector's claim needs at least one scope, so
a tool whose registration grants none is not offered it.

### The members

The store gets the filters and the page: `role` as a URI (`Learner` is already `.../membership#Learner`), `resourceLinkId`, `groups`,
`since`, a `limit` of `limit`, else `pageSize` (100), at most `maxPageSize` (1,000), and the opaque `cursor`. It answers
`{ items, cursor?, differences?, context? }`: the members, where the next page starts, a token that a later request returns as
`since`, and the `label` and `title` of the context. The platform answers with the container, whose `id` is the URL of the context's
members (with `?rlid=` for a resource link, as NRPS 3 shows), and with a `Link` header: `next`, built from the request with the
`cursor`, and `differences`, built from the request with `since` set to the token and no cursor, "complete and opaque" as NRPS asks.

The platform shares only what the request asked for: a member's `groupEnrollments` only with `groups=true`, and the `message` only
with a `rlid`; it drops the rest of what the store gave. A member with the status `Deleted` is for a read of the differences alone
(NRPS 2.0, membership status): outside one it breaks the store's contract. A store that does not know the resource link, finds the
link not the tool's or not in the context (NRPS 2.0, access restriction), or has lost the cursor or the token, answers `undefined`,
which is 404.

### The groups and the record

A request for groups with `user_id` reaches the store with `userId`, and the answer names the user and has the request's URL as its
`id` (Context Groups 2.1.2). The routes of groups and sets page like the members, with a `next` link that keeps the filter. The
record route reads `fields` and drops every member of the store's record that it does not name (the connector: "MUST ONLY be
returned"); the user and the activity of the path reach the store decoded, and the store decides whether the tool may read them.

## Limits

| Limit                                             | Value                       |
| ------------------------------------------------- | --------------------------- |
| An answer read by the client                      | 1,048,576 bytes, 1,000,000 JSON tokens |
| The `limit` of a request of the client            | 100                         |
| A page of the platform                            | 100 items, at most 1,000    |
| An access token of the platform                   | 3,600 seconds               |

## Failure paths

| Port or call          | Fails                                                                  | Hangs               | Called again                                                      |
| --------------------- | ---------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `RosterStore`, `GroupStore`, `PreferencesStore` | 500 with nothing of the cause; `undefined`: 404, and a tool whose cursor is gone starts from the first page | `signal` | Read-only: safe |
| The client's `fetch`  | `ServiceError`; a 404 of a record is `undefined`; a 401 drops the token | `timeoutMs`        | GETs are safe                                                     |

A store that answers with something other than its contract (a member without roles, a page larger than its limit, a `Deleted`
member outside the differences, a record that is not an object) is a `DataError` that the handler throws.

## Errors

| Error                                               | When                                                                          | What to do                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `LtiError` `scope-unavailable`, `scope-denied`      | The platform did not offer, or did not grant, the scope of the call           | Ask the platform's administrator for the scope         |
| `LtiError` `service-origin-refused`                 | The URL may not receive the token                                             | Name the platform's origins in `serviceOrigins`        |
| `ServiceError`                                      | The platform answered with an error, among them 404 for a link that is gone    | Read its `status`; start again from the first page     |
| `DataError`                                         | An argument has the wrong type, an answer breaks its model, or a store breaks its contract | Fix the caller, the store or the limit      |

## Data flows

These services carry personal data: names, email addresses, roles and the needs of a user.

| Data                                   | Comes from                    | Goes to                                                         | Kept by the package |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------- |
| The members: names, email, roles       | The host's `RosterStore`      | The tool, over HTTPS, for the tool's token                       | No                  |
| The group enrollments, the message     | The host's `RosterStore`      | The tool, only when the request asked for them                  | No                  |
| The record of needs and preferences    | The host's `PreferencesStore` | The tool, with the fields the request named                     | No                  |
| An access token                        | The platform's token endpoint | The services, in `Authorization`; the client's cache until near its expiry | Only in memory, in the client |

A platform shares more than a user's identifier and roles only on the agreement with the tool (NRPS 2.0): the store decides what a
member carries.

## Not included

| What                                                              | Reason                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The other endpoints of the AfA PNP Connector and its data model   | A standard of its own; only the endpoint that LTI makes available is here, and the record passes as JSON |
| The substitution variables of the groups (`CourseGroup.id`)       | The host's, through `substitution`                                                             |
| The `message` of a resource link member from the library          | The store gives it: it holds the member's launch claims, which the platform's substitution knows |
| A roster, a database                                              | The host's, behind the three stores                                                            |

## Differences from the references

None of the references that were read has a platform role (see [architecture](architecture.md)), so the platform is checked against
the specifications and their examples, and the client against a platform written from them. Where the texts disagree with their
examples, see [spec-gaps](spec-gaps.md).
