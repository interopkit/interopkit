# Gaps in the specification

Where the LRS book, the Content book and the examples disagree, or say nothing, the package follows the rule below and a test
pins the choice. The examples are those that `pnpm spec-examples` downloads at pinned hashes.

```mermaid
flowchart LR
  text["The LRS and Content books"] --> gap{"Silent, or<br/>the books differ?"}
  gap -->|"no"| follow["The code follows the text"]
  gap -->|"yes"| rule["The code follows the rule below;<br/>this page records the difference;<br/>a test reads the case both ways"]
```

| Where                                  | What the standard says                                                                                                              | What the package does                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| "may not reject" (4.2.4.1)             | "An LRS may not reject a Statement solely based on the order of properties"                                                         | Read as "shall not reject": the order of properties never matters                                                       |
| `stored`                               | "Not Recommended" in the LRS book and "Set by LRS" in the Content book                                                              | An LRS reads it as a time; a provider gets the warning `lrs-managed-property`                                           |
| `version`                              | An LRS "should not reject a Statement that is otherwise valid except the version"; a provider "shall set it to 2.0.0" if it sets it | An LRS accepts any string; a provider gets an error for another value and a warning for `2.0.0`                         |
| The examples print `version`           | The long example and the signed example carry `"1.0.0"`                                                                             | An LRS accepts them; the provider role reports `invalid-value`, and a test pins it                                      |
| The first example                      | The simple Statement has a string with line breaks, which JSON does not allow                                                       | It is not read; the pinned hash covers the examples that are JSON                                                       |
| Performance responses                  | The table writes a range as `min[:]max`; the example writes `pong[.]1:[,]dg[.]:10[,]lunch[.]` with `:`                              | A response of a step is free text, so both are accepted                                                                 |
| An anonymous Group with no members     | `member` is required, and nothing says how many                                                                                     | The property must be present; an empty list is accepted                                                                 |
| Interaction components of another type | An LRS "may" validate the lists that an interaction type has; a provider "shall not" add properties                                 | A list that the type lacks is a warning for an LRS and an error for a provider                                          |
| Response patterns                      | The forms are in a table, and "characterstring parameters are not validated by the LRS"                                             | A pattern of another form is a warning in both roles                                                                    |
| Timestamps                             | RFC 3339 for a provider, "ISO 8601" in the heading; an LRS "shall convert Timestamps to UTC"                                        | RFC 3339 with an offset for both roles: a time without an offset is refused                                             |
| Case of a UUID                         | "Standard string form" and variant 2 "should"                                                                                       | Digits of either case; another variant is the warning `uuid-variant`; two ids that differ in case are one id in a batch |
| `authority`                            | "Agent or Group" in 2.0, with no rule for the pair of an OAuth consumer and a user                                                  | An Agent or a Group                                                                                                     |
