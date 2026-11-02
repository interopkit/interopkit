/**
 * Course packages of cmi5: a ZIP archive of 32 or 64 bits with `cmi5.xml` at its root, or the XML of a course structure
 * alone, read within limits and written.
 *
 * @module @interopkit/course-launch/package
 */

export {
  type CoursePackage,
  type CoursePackageReadOptions,
  readCoursePackage,
} from "./read-course-package.js";
export { writeCoursePackage } from "./write-course-package.js";
