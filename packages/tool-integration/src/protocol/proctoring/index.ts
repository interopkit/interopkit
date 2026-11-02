/**
 * The bodies of the Assessment Control Service of Proctoring Services: the request of a proctoring tool and the status it answers with.
 *
 * @module
 */
export {
  ATTEMPT_STATUSES,
  type AttemptStatus,
  CONTROL_ACTIONS,
  type ControlAction,
  type ControlRequest,
  type ControlStatus,
} from "./model.js";
export { readControlRequest, readControlStatus } from "./read.js";
export { writeControlRequest, writeControlStatus } from "./write.js";
