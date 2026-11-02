import { type HttpResponse, jsonResponse } from "@interopkit/core/http";
import { CALIPER_CONTEXT, type EndpointConfiguration } from "../model/index.js";
import type { EndpointSettings } from "./options.js";

/** The bytes in a kilobyte of `caliperMaximumPayloadSize`, which the specification does not define. */
const BYTES_PER_KILOBYTE = 1024;

/** Answers the GET of a sensor with the configuration of the endpoint (Caliper 1.2 section 6.2): 200 and a JSON body. */
export function configurationAnswer(settings: EndpointSettings): HttpResponse {
  const configuration: EndpointConfiguration = {
    caliperMaximumPayloadSize: Math.floor(settings.maxPayloadBytes / BYTES_PER_KILOBYTE),
    caliperSupportedVersions: [CALIPER_CONTEXT],
    ...(settings.extensions === undefined ? {} : { caliperSupportedExtensions: settings.extensions }),
  };
  return jsonResponse(200, configuration);
}
