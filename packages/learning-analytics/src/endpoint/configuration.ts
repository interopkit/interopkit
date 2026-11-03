import { type HttpResponse, jsonResponse } from "@interopkit/core/http";
import type { EndpointConfiguration } from "../model/index.js";
import { BYTES_PER_KILOBYTE, type EndpointSettings } from "./options.js";
import { contextOfVersion } from "./versions.js";

/** Answers the GET of a sensor with the configuration of the endpoint (Caliper 1.2 section 6.2): 200 and a JSON body. */
export function configurationAnswer(settings: EndpointSettings): HttpResponse {
  const configuration: EndpointConfiguration = {
    caliperMaximumPayloadSize: Math.floor(settings.maxPayloadBytes / BYTES_PER_KILOBYTE),
    caliperSupportedVersions: settings.versions.map(contextOfVersion),
    ...(settings.extensions === undefined ? {} : { caliperSupportedExtensions: settings.extensions }),
  };
  return jsonResponse(200, configuration);
}
