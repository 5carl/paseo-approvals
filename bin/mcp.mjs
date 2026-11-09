#!/usr/bin/env node
// A stdio MCP server so any agent can reach the owner through Approvals with no custom code.
//   claude mcp add approvals -- node /path/to/paseo-approvals/bin/mcp.mjs
// Tools: ask_owner (blocks until a tap or the timeout), notify_owner (no answer).
// Inside a Paseo agent, PASEO_AGENT_ID ties each card to that agent's chat.
import { createInterface } from "node:readline";
import { call } from "./client.mjs";

const TOOLS = [
  {
    name: "ask_owner",
    description: "Ask the owner a question on their phone (an Approvals card in the Paseo app) and wait for the button they tap. Use for approvals and decisions you cannot make yourself. Returns the label they picked, or that nobody answered in time.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The question, one line." },
        body: { type: "string", description: "Optional context, markdown." },
        options: { type: "array", items: { type: "string" }, maxItems: 6, description: "Button labels, most likely first. Default: Approve, Deny." },
        timeout_minutes: { type: "number", description: "How long to wait, 1 to 1440. Default 10." },
        image_path: { type: "string", description: "Optional png/jpg/gif/webp to show on the card." },
        url: { type: "string", description: "Optional link shown on the card." },
      },
      required: ["title"],
    },
  },
  {
    name: "notify_owner",
    description: "Tell the owner something on their phone without waiting for an answer (an FYI card in the Paseo app).",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, title: { type: "string" }, image_path: { type: "string" } },
      required: ["text"],
    },
  },
];

async function run(name, a) {
  if (name === "ask_owner") {
    const minutes = Math.min(Math.max(Number(a.timeout_minutes) || 10, 1), 1440);
    const labels = Array.isArray(a.options) ? a.options.map(String).slice(0, 6) : [];
    const r = await call("ask", {
      title: a.title, body: a.body, imagePath: a.image_path, url: a.url, timeoutSec: minutes * 60, wait: true,
      options: labels.length ? labels.map((label, i) => ({ id: `o${i}`, label })) : undefined,
    }, { timeoutMs: (minutes + 1) * 60 * 1000 });
    if (!r.ok) return { error: r.error || "Approvals failed" };
    if (r.status !== "done") return { text: `No answer: the card ${r.status === "expired" ? "expired" : "was closed"}. Do not assume a yes.` };
    return { text: `The owner picked: ${r.label ?? r.answer}` };
  }
  if (name === "notify_owner") {
    const r = await call("notify", { text: a.text, title: a.title, imagePath: a.image_path });
    return r.ok ? { text: "Sent." } : { error: r.error || "Approvals failed" };
  }
  return { error: `unknown tool ${name}` };
}

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  if (m.method === "initialize") return reply({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "approvals", version: "0.1.0" } });
  if (m.method === "ping") return reply({});
  if (m.method === "tools/list") return reply({ tools: TOOLS });
  if (m.method === "tools/call") {
    const r = await run(m.params?.name, m.params?.arguments ?? {});
    return reply({ content: [{ type: "text", text: r.error ?? r.text }], isError: !!r.error });
  }
  send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } });
});
