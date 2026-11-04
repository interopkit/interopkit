# Supported

What `@interopkit/competency-frameworks` implements of CASE. The package implements these specifications; [the evidence](evidence.md) gives each check with its count and date, and
the package claims nothing of a provider or a consumer.

```mermaid
flowchart LR
  spec["CASE Service 1.1<br/>and 1.0"] --> model["Information Model<br/>classes, vocabularies"]
  model --> read["Readers<br/>schemas, rules of a package"]
  model --> version["Conversion 1.1 to 1.0"]
  model --> graph["Tree, crosswalk, difference,<br/>staleness, adoption status"]
  model --> client["Client<br/>twelve endpoints, paging,<br/>filter, errors"]
  model --> provider["Provider<br/>REST binding, query grammar,<br/>discovery"]
  version --> provider
  spec -.-> outside["Not included:<br/>Markdown and LaTeX rendering,<br/>JSON-LD form of 1.0"]
```

| Area                                 | Specification                      | Included                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The package                          | Information Model 7.1.21           | `CasePackage`: one document, items, associations, definitions, rubrics, `extensions`                                                                                                   |
| The document, items and associations | Information Model 7.1.1 to 7.1.25  | In a package (`CFPckg*`) and outside it (`CFDocument`, `CFItem`, `CFAssociation`)                                                                                                      |
| The definitions                      | Information Model 7.1.6 to 7.1.19  | `CFConcept`, `CFSubject`, `CFLicense`, `CFItemType`, `CFAssociationGrouping`, `CFDefinition`                                                                                           |
| Rubrics                              | Information Model 7.1.26 to 7.1.31 | `CFRubric`, `CFRubricCriterion`, `CFRubricCriterionLevel`                                                                                                                              |
| The sets                             | Information Model 7.1.5 to 7.1.34  | `CFDocumentSet`, `CFAssociationSet`, `CFConceptSet`, `CFSubjectSet`, `CFItemTypeSet`                                                                                                   |
| Links                                | Information Model 7.1.35, 7.1.36   | `LinkURI`, `LinkGenURI` with `targetType`                                                                                                                                              |
| Status                               | Information Model 7.1.37 to 7.1.39 | `ImsxStatusInfo`, read as the kind `imsx_StatusInfo`, the codes of 7.4.4 to 7.4.6 and `invalid_filter_field` of the REST binding                                                       |
| Vocabularies                         | Information Model 7.3, 7.4         | Ten association types, `ext:` terms, `TargetType`, `caseVersion`                                                                                                                       |
| 1.1 additions                        | Information Model 1.3              | `frameworkType`, `caseVersion`, item `subject` and `subjectURI`, association `notes`, `targetType`, `isTranslationOf`, `extensions` on 13 classes, Markdown and LaTeX as text          |
| Package integrity                    | Information Model 3.3, Guide 3.1   | One document, unique identifiers, links that resolve, `isChildOf` without loops, nodes that agree in URI, items in the tree                                                            |
| CASE 1.0 consumers                   | Information Model 1.3              | Reading 1.0, `convertCaseVersion` for a package, an entity and a set, and the forms that 1.0 refuses reported                                                                               |
| Hierarchy, associations, crosswalks  | Implementation Guide 3.3, 4.7      | `buildFrameworkTree`, `listAssociations`, `crosswalk`                                                                                                                                         |
| Change management                    | Implementation Guide 4.2, 4.3      | `diffPackages` for items and `replacedBy`, `readAdoptionStatus` with `Adopted` and `Deprecated` read as their successors                                                                   |
| Caching                              | Implementation Guide 4.1, 4.10     | `isNewer`, `buildEntityUri`                                                                                                                                                             |
| Endpoints, as a consumer             | REST binding 2.1, 2.2              | The client: the twelve endpoints at `/ims/case/v1p1` and `/ims/case/v1p0`, with the set types of 2.4                                                                                   |
| Paging, sorting, filtering, fields   | REST binding 3                     | The client: `limit` and `offset` with `X-Total-Count` and `Link`, `sort` and `orderBy`, the seven predicates with one `AND` or `OR`, dot paths, `fields`                               |
| HTTP codes and status, as a consumer | REST binding 2.4                   | The client: 404 as an absent value, other statuses as `ServiceError`, `imsx_StatusInfo` and `Retry-After` through `readStatusInfo`                                                     |
| Discovery, as a consumer             | REST binding 2.5                   | The client: the localized OpenAPI 3 file of a 1.1 provider                                                                                                                             |
| Security, as a consumer              | REST binding 4                     | The client: TLS only, no redirect, and a credential from a function of the host                                                                                                        |
| The twelve endpoints                 | REST binding 2.1, 2.2, 2.4         | The provider: `/CFDocuments` and eleven by identifier, under `/ims/case/v1p1` and `/ims/case/v1p0`, over a `FrameworkStore`                                                            |
| Paging                               | REST binding 3.1                   | `limit` (100 by default, at most 1,000), `offset`, `X-Total-Count`, `Link`                                                                                                             |
| Sorting                              | REST binding 3.2                   | `sort` and `orderBy` with the Unicode collation of a locale                                                                                                                            |
| Filtering                            | REST binding 3.3                   | `=`, `!=`, `>`, `>=`, `<`, `<=`, `~`, one `AND` or `OR`, dot paths, case-insensitive values, lists; `queryEntities` for a store in memory                                              |
| Field selection                      | REST binding 3.4                   | `fields`                                                                                                                                                                               |
| Failures                             | REST binding 2.4                   | `imsx_StatusInfo` with `invalid_selection_field`, `invalid_filter_field`, `unauthorised_request`, `forbidden`, `server_busy`, `unknownobject`, `invalid_uuid`, `internal_server_error` |
| Service discovery                    | REST binding 2.5                   | The localized OpenAPI file at `/ims/case/v1p1/discovery/imscasev1p1_openapi3_v1p0.json`, and `localizeOpenApi`                                                                         |
| Security                             | REST binding 4                     | The `authorize` port: the host checks TLS and tokens                                                                                                                                   |
| JSON schemas                         | The schemas of 1EdTech             | Every class of both versions, compared in the tests with the published files at pinned hashes, and every answer of the provider against the OpenAPI file of 1.1 and the schemas of 1.0 |

## Not included

| Not included                                 | Why                                                             |
| -------------------------------------------- | --------------------------------------------------------------- |
| Rendering Markdown and LaTeX                 | The consumer's interface does it, through a sanitizing renderer |
| The JSON-LD form of CASE 1.0                 | A document form of 1.0 that 1.1 does not have                   |
| Writing identifiers for a framework          | The host's identifiers are its own; the readers check them, and `buildEntityUri` writes the address of one |
| A store, writing a framework, authentication | The host's: the provider takes a store and an `authorize`       |

[The comparators](comparators.md) map what `@timeback/case` and OpenSALT do against the package: has, partly, excluded with the
reason, or missing.
