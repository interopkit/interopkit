/*
    The adapter of CATAPULT's LMS suite for the example LMS of interopkit (examples/course-launch/serve.ts). The run copies it
    into the suite's lib/ and names it in CATAPULT_LMS; it reaches the LMS at CATAPULT_LMS_BASE with the administrator's
    credential, CATAPULT_LMS_ADMIN, and trusts the certificate of the run through NODE_EXTRA_CA_CERTS.
*/
// biome-ignore lint/correctness/noUndeclaredDependencies: the LMS suite of CATAPULT installs it, and the adapter runs in the suite.
const Wreck = require("@hapi/wreck");
const { InvalidPackageError } = require("./errors");

const base = process.env.CATAPULT_LMS_BASE;
const admin = process.env.CATAPULT_LMS_ADMIN;

/** Calls the automation of the LMS, and resolves with its status and the JSON of its answer. */
async function automate(path, payload, contentType) {
  const response = await Wreck.request("POST", `${base}/automation/${path}`, {
    payload,
    headers: { authorization: admin, "content-type": contentType },
  });
  const body = await Wreck.read(response, { json: "force" });
  return { status: response.statusCode, body };
}

module.exports = {
  setup: async () => {
    if (base === undefined || admin === undefined) throw new Error("Set CATAPULT_LMS_BASE and CATAPULT_LMS_ADMIN.");
  },
  teardown: async () => {},
  // The suite reads `${getLrsEndpoint()}/statements`, so the endpoint goes without its final slash.
  getLrsEndpoint: () => `${base}/xapi`,
  getLrsAuthHeader: () => admin,
  importCourse: async (stream, contentType, filename) => {
    const { status, body } = await automate("courses", stream, contentType);
    if (status === 422) throw new InvalidPackageError(`${filename}: ${body.error}`);
    if (status !== 200) throw new Error(`Importing ${filename} failed: ${status}`);
    return body.courseId;
  },
  getLaunchUrl: async (courseId, auIndex, actor, { registration, launchMode }) => {
    const input = JSON.stringify({ courseId, auIndex, actor, registration, launchMode });
    const { status, body } = await automate("launch", input, "application/json");
    if (status !== 200) throw new Error(`The launch failed: ${status} ${JSON.stringify(body)}`);
    return body.url;
  },
  cleanup: async () => {},
  hasWaive: () => true,
  waiveAU: async (registration, auIndex, reason) => {
    const { status } = await automate("waive", JSON.stringify({ registration, auIndex, reason }), "application/json");
    if (status !== 200) throw new Error(`The waiver failed: ${status}`);
  },
  hasAbandon: () => true,
  abandonSession: async (session) => {
    const { status } = await automate("abandon", JSON.stringify({ session }), "application/json");
    if (status !== 200) throw new Error(`The abandon failed: ${status}`);
  },
};
