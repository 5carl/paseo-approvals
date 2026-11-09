#!/usr/bin/env node
// Approvals from the command line.
//   approvals.mjs ask "Deploy to prod?" [--body TEXT] [--option LABEL]... [--timeout SECONDS] [--icon NAME] [--label TEXT]
//                     [--tone accent|warning|danger|success|muted] [--image PATH] [--url URL] [--source NAME] [--no-wait]
//       Waits for a tap and prints the chosen label (exit 0), or "expired"/"cleared" (exit 3).
//       No --option means Approve / Deny; exit 0 only on Approve, so `approvals.mjs ask "Go?" && deploy` works.
//       --no-wait prints the card id; read it later with `result ID [--wait]`.
//   approvals.mjs notify "text" [--title T] [--source S] [--image PATH]
//   approvals.mjs result ID [--wait]
//   approvals.mjs close ID [--answer TEXT]
// Inside a Paseo agent, PASEO_AGENT_ID ties the card to that agent's chat.
import { call } from "./client.mjs";

const [cmd, ...argv] = process.argv.slice(2);
const flags = { option: [] };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const m = argv[i].match(/^--([a-z-]+)$/);
  if (!m) { rest.push(argv[i]); continue; }
  if (m[1] === "no-wait" || m[1] === "wait") flags[m[1]] = true;
  else if (m[1] === "option") flags.option.push(argv[++i]);
  else flags[m[1]] = argv[++i];
}
const text = rest.join(" ");
const die = (msg, code = 1) => { console.error(`approvals: ${msg}`); process.exit(code); };
const long = { timeoutMs: 25 * 60 * 60 * 1000 };

if (cmd === "ask") {
  if (!text) die("ask needs a title", 2);
  const timeoutSec = flags.timeout ? Number(flags.timeout) : undefined;
  const options = flags.option.length ? flags.option.map((label, i) => ({ id: `o${i}`, label })) : undefined;
  const wait = !flags["no-wait"];
  const r = await call("ask", {
    title: text, body: flags.body, options, timeoutSec, icon: flags.icon, label: flags.label, tone: flags.tone,
    imagePath: flags.image, url: flags.url, source: flags.source, wait,
  }, wait ? long : {});
  if (!r.ok) die(r.error || "failed");
  if (!wait) { console.log(r.id); process.exit(0); }
  if (r.status !== "done") { console.log(r.status); process.exit(3); }
  console.log(r.label ?? r.answer);
  process.exit(options || r.answer === "approve" ? 0 : 1);
} else if (cmd === "notify") {
  if (!text) die("notify needs text", 2);
  const r = await call("notify", { text, title: flags.title, source: flags.source, imagePath: flags.image });
  if (!r.ok) die(r.error || "failed");
  console.log(r.id);
} else if (cmd === "result") {
  const r = await call("result", { id: text, wait: !!flags.wait }, flags.wait ? long : {});
  if (!r.ok) die(r.error || "failed");
  console.log(JSON.stringify(r));
} else if (cmd === "close") {
  const r = await call("close", { id: text, answer: flags.answer });
  if (!r.ok) die(r.error || "failed");
} else die("usage: approvals.mjs ask|notify|result|close ... (see the top of this file)", 2);
