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
`maxEntries` (100,000) and `maxDirectoryBytes` (64 MiB), only `cmi5.xml` is inflated, and an archive is refused for a link, an
encrypted entry, names that fold to one, a header that lies, every warning of zip.js but a wrapped count of entries, no
`cmi5.xml` at its root, and a relative URL that names none of its files. `writeCoursePackage` writes a ZIP package that the
reader takes back, the same bytes for the same course. The examples of the specification and the course packages of CATAPULT
are read, and the 305 requirements of CATAPULT are mapped to the package.
