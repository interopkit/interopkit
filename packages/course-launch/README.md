# @interopkit/course-launch

[cmi5](https://github.com/AICC/CMI-5_Spec_Current) (Quartz), the specification of ADL for launching the units of a course and
tracking them with xAPI: the vocabularies of the specification, the course structure with a reader that enforces its schema
and the rules of cmi5, a validator that lists every finding and a writer, course packages in ZIP or XML, read within limits and
written, the rules of the statements of a session with the readers of what a launch gives, the LMS role over the LRS of
`@interopkit/learning-records`, and the runtime of an assignable unit. It knows nothing of any product.

```mermaid
flowchart LR
  publisher["An authoring tool<br/>a course structure, files"]
  lms["An LMS<br/>an uploaded package"]
  subgraph pkg["@interopkit/course-launch"]
    model["CourseStructure, MoveOn, LaunchMethod,<br/>CMI5_VERBS, CMI5_EXTENSIONS, ..."]
    structure["readCourseStructure, validateCourseStructure,<br/>writeCourseStructure"]
    package["/package<br/>readCoursePackage, writeCoursePackage"]
    rules["readLaunchUrl, readLaunchData, readLearnerPreferences,<br/>classifyStatement, validateSessionStatements"]
    lmsapi["/lms<br/>importCourse, createRegistration, prepareLaunch,<br/>handleFetchRequest, extendLrsOptions, waiveAu"]
    runtime["/au<br/>startAuSession, AuSession"]
  end
  unit["An assignable unit<br/>its page"]
  tool["A tool of reports<br/>a recorded session"]
  tool -->|"statements, facts"| rules
  rules -->|"findings"| tool
  publisher -->|"a structure"| structure
  structure -->|"cmi5.xml"| publisher
  publisher -->|"a structure and files"| package
  package -->|"a ZIP package"| publisher
  lms -->|"ZIP32, ZIP64 or XML"| package
  package -->|"the structure, its files"| lms
  structure --> model
  package --> structure
  rules --> model
  lms -->|"a structure, learners, launches"| lmsapi
  lmsapi --> rules
  lmsapi --> structure
  unit -->|"the launch URL"| runtime
  runtime --> rules
```

It runs in Node.js, browsers, Deno, Bun and edge runtimes such as Cloudflare Workers: it uses web standards only, reads no
environment variable, writes no log and makes no request but through the client of an LRS that the host passes. Its
dependencies are `@interopkit/core`, `@interopkit/learning-records` (the model and the rules of xAPI, its client and its LRS),
[valibot](https://valibot.dev), [saxes](https://github.com/lddubeau/saxes), [uuid](https://github.com/uuidjs/uuid) (`/lms`)
and [zip.js](https://gildas-lormeau.github.io/zip.js/) (`/package`).

```bash
npm install @interopkit/course-launch
```

## API

| Subpath                             | Exports                                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@interopkit/course-launch`         | `readCourseStructure`, `validateCourseStructure`, `writeCourseStructure`, `CourseReadOptions`, `CourseWriteOptions`: read a course structure into the model and throw `DataError` on an error, list its findings, and write it; the model (`CourseStructure`, `AssignableUnit`, `Block`, `Objective`, `LangString`, `ExtensionElement`, `CourseIssue`) and the vocabularies (`MOVE_ON_VALUES`, `LAUNCH_METHODS`, `LAUNCH_MODES`, `CMI5_VERBS`, `CMI5_CATEGORIES`, `CMI5_EXTENSIONS`, `CMI5_ACTIVITY_TYPES`, `COURSE_STRUCTURE_NAMESPACE`, `LAUNCH_DATA_STATE_ID`, `LEARNER_PREFERENCES_PROFILE_ID`) |
| `@interopkit/course-launch`         | `readLaunchUrl`, `readLaunchData`, `readLearnerPreferences`, `writeLearnerPreferences`, `classifyStatement`, `validateSessionStatements`, `SessionFacts`: read the launch URL, the launch data and the preferences of a learner, tell the kind of a statement, and judge the statements of a session; the types `LaunchParameters`, `LaunchData`, `LearnerPreferences` and `AUDIO_PREFERENCES` |
| `@interopkit/course-launch/package` | `readCoursePackage`, `writeCoursePackage`, `CoursePackage`, `CoursePackageReadOptions`: read a ZIP package of 32 or 64 bits or the XML of a structure alone, and write a ZIP package                                                                   |
| `@interopkit/course-launch/au`      | `startAuSession`, `AuSession`, `AuOptions`, `AuResume`, `Recorded`, `PriorOutcome`, `OutcomeOptions`, `AllowedStatementInput`: the runtime of an assignable unit, which fetches its token once, reads its launch data, preferences and registration, and sends the statements of its session, each judged by the rules of cmi5 first |
| `@interopkit/course-launch/lms`     | `importCourse`, `createRegistration`, `prepareLaunch`, `handleFetchRequest`, `extendLrsOptions`, `abandonSession`, `waiveAu`, `progressOf`, the `Cmi5Store` port and its records: import a course with the ids of the LMS, register learners, launch units with a fetch URL of one use, make the host's LRS judge and satisfy by the rules of cmi5, abandon sessions and waive units |

## Quick start

```ts
import { readCourseStructure } from "@interopkit/course-launch";

const xml = `<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://example.org/courses/geology">
    <title><langstring lang="en-US">Introduction to Geology</langstring></title>
    <description><langstring lang="en-US">Plate tectonics and the history of the Earth.</langstring></description>
  </course>
  <au id="https://example.org/courses/geology/au/1" moveOn="CompletedOrPassed" masteryScore="0.8">
    <title><langstring lang="en-US">Plate tectonics</langstring></title>
    <description><langstring lang="en-US">How the plates move.</langstring></description>
    <url>https://content.example.org/geology/1/index.html</url>
  </au>
</courseStructure>`;
const [unit] = readCourseStructure(xml).children;
unit?.kind === "au" ? [unit.moveOn, unit.masteryScore] : undefined;
// => ["CompletedOrPassed", 0.8]
```

## Guides

| Guide                                                    | For                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Architecture](../../docs/course-launch/architecture.md) | The modules, their layers, and what the package owns                                    |
| [Course structure](../../docs/course-launch/structure.md) | Reading, validating and writing `cmi5.xml`: the rules, options, limits and errors       |
| [Course package](../../docs/course-launch/package.md)    | Reading and writing ZIP and XML packages within limits, and what a package may not hold |
| [Rules of a session](../../docs/course-launch/rules.md)  | The launch URL, the launch data, the preferences, and the rules of the statements of a session |
| [Assignable unit](../../docs/course-launch/au.md)        | The runtime of a unit: its start, its statements, a reload, and what it skips and what the LMS refuses |
| [LMS](../../docs/course-launch/lms.md)                   | Registrations, launches, the fetch URL, the rules of cmi5 on the host's LRS, satisfaction, abandoned sessions and waivers |
| [Evidence](../../docs/course-launch/evidence.md)         | The requirement map, CATAPULT's suites, the counterparties, speed, size and peak memory |
| [Comparators](../../docs/course-launch/comparators.md)   | The other implementations of cmi5 and how their capabilities map to the package         |
| [Supported](../../docs/course-launch/supported.md)       | What of cmi5 the package covers, and what it leaves out                                 |
| [Spec gaps](../../docs/course-launch/spec-gaps.md)       | Where the specification, its schema and CATAPULT differ, and the reading taken          |

It passes CATAPULT's LMS and content suites at `806c0ba` ([evidence](../../docs/course-launch/evidence.md)). cmi5 is a
specification of ADL; this package implements it and is not certified or endorsed by ADL.
