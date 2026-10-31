/**
 * The sensor: sends events to a Caliper endpoint in one envelope.
 *
 * @module
 */
export {
  type CaliperSender,
  DEFAULT_CALIPER_TIMEOUT_MS,
  type SendCaliperOptions,
  sendCaliper,
} from "./send-caliper.js";
