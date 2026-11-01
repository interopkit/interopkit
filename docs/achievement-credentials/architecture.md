# Architecture of achievement-credentials

`@interopkit/achievement-credentials` has four modules that share one model. `model` holds the types, the vocabularies and the
findings. `read` turns untrusted JSON into the model. `issue` writes credentials from their parts, and `compare` looks at
credentials. `read` imports only `model` and `@interopkit/core`, `issue` and `compare` import those and `read` and never each
other, and `model` imports nothing of the family.

```mermaid
flowchart BT
  core["@interopkit/core<br/>DataError, checks"]
  model["model<br/>types, vocabularies, contexts, CredentialIssue"]
  read["read<br/>schemas, findings, rules of the subject"]
  issue["issue<br/>builders, identity hash, CASE alignment"]
  compare["compare<br/>equality, newer, summary"]
  root["index.ts<br/>the public API"]
  read --> model
  read --> core
  issue --> read
  issue --> core
  compare --> read
  compare --> core
  root --> model
  root --> read
  root --> issue
  root --> compare
```

| Module    | Files                                                                                            | Holds                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `model`   | `credentials.ts`, `credentials-v1p1.ts`, `clr.ts`, `api.ts`, `keys.ts`                           | The types of every class, by the part of the specifications that defines it                                                    |
|           | `vocabularies.ts`, `context.ts`, `kinds.ts`, `issue.ts`                                          | The vocabularies as tuples with their types, `CONTEXTS`, `CREDENTIAL_KINDS`, `ENTITY_KINDS`, `CredentialIssue`                 |
| `read`    | `credential-schemas.ts`, `v1p1-schemas.ts`, `clr-schemas.ts`, `api-schemas.ts`, `key-schemas.ts` | The valibot schema of each class, built once, typed by the interface of the class                                              |
|           | `primitives.ts`                                                                                  | The parts the schemas share: a list that may be one member, the `type` of a class, an extensible term, contexts                |
|           | `registry.ts`, `inspect.ts`, `rules.ts`, `options.ts`                                            | Which schema reads which kind, the parse and its findings, the rules of the subject, the check of the options                  |
|           | `read-credential.ts`, `read-entity.ts`                                                           | The readers and the validators                                                                                                 |
| `issue`   | `build-achievement-credential.ts`, `build-endorsement-credential.ts`, `build-clr-credential.ts`  | The builders, each a few lines that write the credential around the checked input                                              |
|           | `inputs.ts`, `input-schemas.ts`, `finish.ts`, `refusal.ts`, `schema-urls.ts`                     | The input types, the schemas that read an input, the check of what was written, the error of every fault, the official schemas |
|           | `case-alignment.ts`, `identity.ts`                                                               | The alignment to a CASE item, and the hash and the matching of an identity                                                     |
| `compare` | `same-credential.ts`, `newer-credential.ts`, `comparable.ts`                                     | Equality and replacement of credentials as Open Badges 10                                                                      |
|           | `credential-summary.ts`                                                                          | What a wallet shows of a credential                                                                                            |

`@interopkit/core/checks` holds what other standards need as much: records that refuse or keep unknown properties, the formats
of a date and a date and time, the copy of JSON within a depth limit, and the conversion of the issues of a parse to findings
that own their rule names.

Each module has an `index.ts`, its public API, and `read` has an `internal.ts` for what the other modules and the tests share
and the package does not export: the schemas, which the tests compare with the schemas of 1EdTech and the builders write
with. `pnpm check:standards` and Biome keep modules from
importing by a deep path or against the layers.

## Reading

```mermaid
sequenceDiagram
  participant H as Host
  participant R as readCredential
  participant J as Copy of JSON
  participant S as Schema of the kind
  participant I as Rules of the subject
  H->>R: value, options
  R->>R: check the options (DataError)
  R->>J: copy within 64 levels
  alt not JSON, or too deep
    J-->>R: a problem
    R-->>H: DataError
  else JSON
    R->>S: parse every property
    alt an error of the shape
      S-->>R: findings
      R-->>H: DataError: the first error and how many follow
    else the shape is right
      S-->>R: a copy of the credential
      R->>I: the subject
      I-->>R: findings
      R-->>H: the copy, or DataError when one is an error
    end
  end
  Note over H,R: validateCredential runs the same steps and returns every finding
```

The schemas are written once for each class, with the classes that refer to each other joined by a reference that is read when
the first value is. The kind of credential comes from its `type`, and the data model from its first context. A list of the
properties of each class is kept with its schema, so that the tests compare it with the schemas of 1EdTech and fail when a class
or a property differs.

## Boundaries

| The package owns                                                                    | The package does not own                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The model of Open Badges 3.0 and CLR 2.0, the readers, the builders, the comparison | Proofs and keys, status lists, verification, baking, the APIs, Open Badges 2.0: later modules |
| The classes under both Verifiable Credentials data models                           | Wallets, issuer platforms, storage                                                            |
