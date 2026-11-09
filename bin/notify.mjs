#!/usr/bin/env node
// Post an FYI card to Approvals: notify.mjs [--title T] [--source S] [--image PATH] "text"   (or text on stdin)
// Exits 0 when the card was created, 1 when Approvals is not reachable (callers fall back).
import path from "node:path";
import { call } from "./client.mjs";

const argv = process.argv.slice(2);
const args = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const m = argv[i].match(/^--(title|source|image)$/);
  if (m) args[m[1] === "image" ? "imagePath" : m[1]] = argv[++i];
  else rest.push(argv[i]);
}
let text = rest.join(" ");
if (!text && !process.stdin.isTTY) text = await new Promise((r) => { let b = ""; process.stdin.on("data", (d) => (b += d)).on("end", () => r(b.trim())); });
if (!text) { console.error("notify: no text"); process.exit(2); }
if (args.imagePath) args.imagePath = path.resolve(args.imagePath);
const r = await call("notify", { ...args, text }, { agentId: undefined, timeoutMs: 10000 });
if (r.ok) { console.log("sent (approvals)"); process.exit(0); }
console.error(`notify: ${r.error || "failed"}`);
process.exit(1);
