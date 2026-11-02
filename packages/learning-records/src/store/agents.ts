import { callPort } from "@interopkit/core";
import { parseWith } from "@interopkit/core/checks";
import { type HttpResponse, jsonResponse, readQuery } from "@interopkit/core/http";
import type { Agent, Person } from "../model/index.js";
import { personSchema } from "../read/internal.js";
import { checkNames, readAgent } from "./parameters.js";
import { FAILED } from "./status.js";
import { attempt, type Context, isRefusal } from "./verdict.js";

/** Makes the Person that an Agent is when the LRS knows nothing else of them: their identifiers, each as a list. */
function personOf(agent: Agent): Person {
  return {
    objectType: "Person",
    ...(agent.name === undefined ? {} : { name: [agent.name] }),
    ...(agent.mbox === undefined ? {} : { mbox: [agent.mbox] }),
    ...(agent.mbox_sha1sum === undefined ? {} : { mbox_sha1sum: [agent.mbox_sha1sum] }),
    ...(agent.openid === undefined ? {} : { openid: [agent.openid] }),
    ...(agent.account === undefined ? {} : { account: [agent.account] }),
  };
}

/** Answers a GET or HEAD for the Agents resource (4.1.6.3): the Person the Agent is. */
export async function handleAgents(context: Context): Promise<HttpResponse> {
  const { settings, request } = context;
  const asked = attempt(() => {
    const parameters = readQuery(request);
    checkNames(parameters, new Set(["agent"]));
    return readAgent(parameters.get("agent"), settings.limits);
  });
  if (isRefusal(asked)) return context.refuse(asked.status, asked.message);
  const { agents, signal } = settings;
  if (agents === undefined) return jsonResponse(200, personOf(asked.value));
  const found = await callPort(() => agents.person(asked.value, { signal }), signal);
  if (found === undefined) return context.refuse(500, FAILED);
  return jsonResponse(200, parseWith(personSchema, found.value, "The answer of AgentStore.person"));
}
