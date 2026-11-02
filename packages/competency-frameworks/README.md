# @interopkit/competency-frameworks

CASE (Competencies and Academic Standards Exchange) [1.1](https://www.imsglobal.org/spec/case/v1p1) and
[1.0](https://www.imsglobal.org/spec/case/v1p0): the model of a competency framework package and of each entity that CASE
exchanges, readers that check them against the JSON schemas of 1EdTech and the rules of a package, validators that list
every finding, the conversion of 1.1 data to the form of 1.0, what a consumer asks of a framework (its tree, its crosswalks,
its changes and its staleness), a client that reads frameworks from a provider, and a provider that serves a store of
frameworks over the REST binding. It knows nothing of any product: the host says where a framework comes from and what it
is for.

```mermaid
flowchart LR
  host["Your application<br/>a framework from a file, a response<br/>or your own database"]
  subgraph pkg["@interopkit/competency-frameworks"]
    read["readPackage, readEntity<br/>schemas, then identifiers, links, tree"]
    validate["validatePackage, validateEntity"]
    version["toCaseVersion"]
    graph["/graph<br/>frameworkTree, crosswalk,<br/>diffPackages, isNewer"]
    client["/client<br/>createCaseClient, caseFilter"]
    provider["/provider<br/>handleCaseRequest over a FrameworkStore<br/>paging, filter, sort, fields, discovery"]
  end
  model["CasePackage, CFItem, ...<br/>the model of CASE 1.1"]
  old[("A consumer of CASE 1.0")]
  host -->|"JSON as parsed"| read
  read --> model
  host -->|"JSON as parsed"| validate
  validate -->|"findings"| host
  model --> version
  model --> graph
  graph -->|"tree, links, changes"| host
  version -->|"1.0 form and what was left out"| old
  remote[("A CASE provider")]
  host -->|"id, query, your fetch"| client
  client -->|"GET"| remote
  remote -->|"JSON"| client
  client -->|"valid CASE 1.1"| host
  client --> read
  consumer[("A consumer of CASE")]
  host -->|"HttpRequest, FrameworkStore"| provider
  provider -->|"HttpResponse in 1.1 or 1.0"| consumer
  version --> provider
```

It runs in Node.js, browsers, Deno, Bun and edge runtimes such as Cloudflare Workers: it uses web standards only, reads no
environment variable and writes no log. The only requests it makes are those of the client, through the `fetch` that the
host passes in. Its dependencies are `@interopkit/core` and [valibot](https://valibot.dev).

```bash
npm install @interopkit/competency-frameworks
```

## API

| Subpath                             | Exports                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@interopkit/competency-frameworks` | `readPackage`, `readEntity`, `ReadOptions`: read a package or an entity of either version into the model of 1.1, and throw `DataError` on an error                                                                                                        |
|                                     | `validatePackage`, `validateEntity`, `CaseIssue`: judge a value and return every finding, errors and warnings, as data                                                                                                                                    |
|                                     | `toCaseVersion`, `VersionedValue`, `Converted`: a package or an entity in the form of 1.0, and what was left out                                                                                                                                          |
|                                     | `CasePackage`, `CFPckgDocument`, `CFPckgItem`, `CFPckgAssociation`, `CFDocument`, `CFItem`, `CFAssociation`, `CFDefinition` and the other classes: the model                                                                                              |
|                                     | `ASSOCIATION_TYPES`, `CASE_VERSIONS`, `ENTITY_KINDS`, `SERVED_KINDS`, `CaseEntityMap`, `STATUS_CODES_MAJOR`, `STATUS_CODES_MINOR`, `STATUS_SEVERITIES`, `CaseVersion`, `CaseEntityKind`, `CaseEntity`, `ImsxStatusInfo` and the types of the vocabularies |
|                                     | `CaseQuery`, `CaseFilter`, `CaseCondition`, `OpenApiDocument`, `FILTER_PREDICATES`, `SORT_ORDERS`: what the provider and a client of the endpoints share                                                                                                  |
| `.../client`                        | `createCaseClient`, `CaseClient`, `CaseClientConfig`: a call for each of the twelve endpoints, paging, errors                                                                                                                                             |
|                                     | `caseFilter`, `readStatusInfo`, `StatusDetail`, `SelectedDocument`: the filter of a request, and the status and `Retry-After` of a refusal                                                                                                                |
| `.../graph`                         | `frameworkTree`, `associationsOf`, `crosswalk`, `diffPackages`, `isNewer`, `adoptionStatus`, `caseEntityUri`: the questions a consumer asks of a package; `ADOPTION_STATUSES` and the types of the answers and options: `FrameworkNode`, `NodeAssociations`, `CrosswalkLink`, `CrosswalkOptions`, `PackageDiff`, `ChangedItem`, `ReplacedItem`, `AdoptionStatus`, `CaseEntityUriOptions` |
| `.../provider`                      | `handleCaseRequest`, `CaseProviderOptions`: serve the twelve endpoints of the binding, in 1.1 and in 1.0, over a store                                                                                                                  |
|                                     | `FrameworkStore`, `DocumentPage`: what the provider needs from the host                                                                                                                                                                       |
|                                     | `parseCaseQuery`, `ParsedCaseQuery`, `QueryRefusal`, `queryEntities`, `QueryEntitiesOptions`: the query grammar, and the filter and sort in memory                                                                                                        |
|                                     | `localizeOpenApi`, `LocalizeOpenApiOptions`: the OpenAPI file of 1EdTech made into the localized discovery file                                                                                                                                           |

```ts
import { readPackage, toCaseVersion, validatePackage } from "@interopkit/competency-frameworks";

const input = {
  CFDocument: {
    identifier: "8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60",
    uri: "https://standards.example.org/ims/case/v1p1/CFDocuments/8f3e2a14-4c1b-4d77-9a3e-1b2c3d4e5f60",
    caseVersion: "1.1",
    creator: "Ministry of Education",
    title: "Mathematics",
    lastChangeDateTime: "2024-06-13T18:46:03+00:00",
  },
  CFItems: [
    {
      identifier: "2b6d1c9e-7a53-4e08-b1f4-5c8a9d0e3f21",
      uri: "https://standards.example.org/ims/case/v1p1/CFItems/2b6d1c9e-7a53-4e08-b1f4-5c8a9d0e3f21",
      fullStatement: "Understand fractions as numbers.",
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    },
  ],
};
const pkg = readPackage(input);
pkg.CFItems?.length; // => 1
pkg === input; // => false

validatePackage(pkg).map((finding) => `${finding.severity} ${finding.rule} at ${finding.path}`); // => ["warning item-outside-tree at CFItems[0]"]

const old = toCaseVersion(pkg, "1.0");
old.dropped.map((finding) => finding.path); // => ["CFDocument.caseVersion"]
"caseVersion" in old.value.CFDocument; // => false

validatePackage({ CFDocument: { title: 5 } }).map((finding) => `${finding.path} ${finding.rule}`); // => ["CFDocument.identifier missing-property", "CFDocument.uri missing-property", "CFDocument.creator missing-property", "CFDocument.title wrong-type", "CFDocument.lastChangeDateTime missing-property"]
```

`readPackage` and `readEntity` return the model, or throw a `DataError` that names the path of the first error and counts the
others. `validatePackage` and `validateEntity` do not throw for a value, and return each finding with its `path`, its `rule`,
a `message` and its `severity`. A warning does not keep a value from being read.

## What this version includes

| Part of CASE                                  | Included                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classes of the Information Model, 1.1 and 1.0 | Every class: the package, its document, items, associations, definitions and rubrics, the entities outside a package, the five sets and `imsx_StatusInfo`                                                |
| Vocabularies                                  | The ten association types, `ext:` terms, `targetType`, `caseVersion`, the codes of a status                                                                                                              |
| Package rules                                 | One document, unique identifiers, links that resolve, `isChildOf` without loops, items in the tree                                                                                                       |
| 1.0                                           | Reading it, and the conversion from 1.1 with a report of what 1.0 cannot hold                                                                                                                            |
| Hierarchy, associations, change               | The tree from `isChildOf`, the associations of a node, crosswalks between frameworks, the difference between versions, the staleness of a copy, the adoption status                                      |
| The REST binding, as a consumer               | The twelve endpoints with their set types, paging with `X-Total-Count` and `Link`, sort, filter and field selection, `imsx_StatusInfo`, discovery, TLS only, a credential through a function of the host |
| The provider                                  | The twelve endpoints in both versions, paging, sorting, filtering, field selection, the status of a failure, service discovery                                                                           |

[The model guide](https://github.com/interopkit/interopkit/blob/main/docs/competency-frameworks/model.md),
[the graph guide](https://github.com/interopkit/interopkit/blob/main/docs/competency-frameworks/graph.md),
[the client guide](https://github.com/interopkit/interopkit/blob/main/docs/competency-frameworks/client.md) and
[the provider guide](https://github.com/interopkit/interopkit/blob/main/docs/competency-frameworks/provider.md) have the options
with their defaults, the findings and their rules, the limits, the errors and what to do about them, what is not included and
why, and the differences from the references.

[The evidence guide](https://github.com/interopkit/interopkit/blob/main/docs/competency-frameworks/evidence.md) shows what the
package was checked against: the official schemas, real frameworks of public providers, an example provider and consumer,
OpenSALT, the speed of reading and four runtimes.

## License

[Apache-2.0](LICENSE). Copyright Fariz Wakan. CASE and 1EdTech are trademarks of 1EdTech Consortium, Inc.; see
[NOTICE](NOTICE). This package implements CASE 1.1 and 1.0 and is not certified by 1EdTech.
