---
"@interopkit/course-launch": minor
---

cmi5 Quartz. The vocabularies of the specification: `MOVE_ON_VALUES`, `LAUNCH_METHODS`, `LAUNCH_MODES`, `CMI5_VERBS`,
`CMI5_CATEGORIES`, `CMI5_EXTENSIONS`, `CMI5_ACTIVITY_TYPES`, `COURSE_STRUCTURE_NAMESPACE`, `LAUNCH_DATA_STATE_ID` and
`LEARNER_PREFERENCES_PROFILE_ID`. `readCourseStructure` reads a course structure, `cmi5.xml`, into the model of the course, its
objectives, its blocks and its assignable units, and throws a `DataError` that names the path of the first error;
`validateCourseStructure` lists every finding, at most `maxFindings` (1,000), as data. Both enforce every constraint of
`CourseStructure.xsd`, with libxml2 as the oracle of the tests, and the rules of cmi5 that the schema leaves out: IRIs fully
qualified, ids unique among the blocks, the objectives and the assignable units, objective references that name an objective,
a mastery score of at most 4 decimal places, and the URL of an assignable unit in the characters of RFC 1738, with a scheme of
`launchSchemes` followed by `//`, relative only in a ZIP package and below its root, and without the parameters of the launch in
its query. They read UTF-8, or UTF-16 with a byte order mark, refuse a DOCTYPE, and stop at `maxBytes` (16 MiB), `maxDepth` (64)
and `maxElements` (1,000,000). Extensions of the structure, the course, blocks and assignable units are kept as written;
`writeCourseStructure` writes the model as XML that the reader takes back. `@interopkit/course-launch/package` reads a course
package, a ZIP archive of 32 or 64 bits or the XML alone, told apart by their first bytes: a ZIP archive is read in place within
`maxEntries` (100,000) and `maxDirectoryBytes` (16 MiB), only `cmi5.xml` is inflated, and an archive is refused for a link, an
encrypted entry, names that an extractor writes as one file, a header that lies, every warning of zip.js but a wrapped count of entries, no
`cmi5.xml` at its root, and a relative URL that names none of its files. `writeCoursePackage` writes a ZIP package that the
reader takes back, the same bytes for the same course. `readLaunchUrl`, `readLaunchData` and
`readLearnerPreferences` read what a launch gives an assignable unit, and `writeLearnerPreferences` writes the preferences of a
learner. `classifyStatement` tells a statement that cmi5 defines from one it allows and one it does not, and
`validateSessionStatements` judges the statements of a session against its launch data and its registration: the rules of xAPI
1.0.3, then the id, the time in UTC, the actor, the registration, the session id and the context template of each statement, its
place between initialized and terminated, and for a statement that cmi5 defines its verb, object, result, score, mastery score
and launch mode. The examples of the specification and the course packages of CATAPULT are read, and the 305 requirements of
CATAPULT are mapped to the package.
`@interopkit/course-launch/lms` is the LMS role. `importCourse` checks a course structure and makes the ids of the LMS for the
course, its blocks and its assignable units, the same in every registration. `createRegistration` registers a learner and
satisfies at once every unit whose `moveOn` is `NotApplicable`. `prepareLaunch` abandons the unit's open session, writes
`LMS.LaunchData` and the launched statement, and returns the launch URL with a fetch code of one use and the window that
`launchMethod` asks for. `handleFetchRequest` answers the fetch URL with the token of the session once, and with error codes 1
to 3. `extendLrsOptions` makes the host's LRS of `@interopkit/learning-records` the LRS of cmi5: a token is refused with 401
before the fetch, after terminated or abandoned and after `maxSessionSeconds`, a unit reads and writes only what is its own and
never changes `LMS.LaunchData`, its statements are judged by the rules of the session and refused with 403, and once the store
holds them the LMS writes the satisfied statements of the blocks and the course that they make due. `abandonSession` and
`waiveAu` write the abandoned and waived statements, and `progressOf` tells what a registration holds. The host keeps the
records in its `Cmi5Store`, whose puts compare a revision.
`@interopkit/course-launch/au` is the runtime of an assignable unit, without a DOM. `startAuSession` reads the launch URL,
refuses an LMS outside `trustedOrigins`, posts to the fetch URL once and turns its error codes into refusals, reads the launch
data, the preferences of the learner and what the registration holds, and returns the session. `initialize`, `complete`,
`pass`, `fail`, `judge` (by the mastery score), `progress`, `send` and `terminate` build each statement with the template of
the session, judge it by the rules of cmi5 and skip what they forbid without a request; a 401 or 403 of the LMS is a refusal,
and a request that fails sends the same statement again on the next call. `resume` goes on after a reload of the page without a
second fetch, `state` keeps the State of the unit, `savePreferences` takes a refusal as a value, and `terminate` returns the
return URL when it is http or https.
The package passes CATAPULT's LMS suite (87 of 87 tests) and its content suite (54 of 54 sessions) at `806c0ba`.
