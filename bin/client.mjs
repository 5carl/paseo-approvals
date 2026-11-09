// Talk to the Approvals hub socket from any script: one JSON line in, one out.
// Finds the socket the same way the plugin does: PASEO_APPROVALS_DATA, else <PASEO_HOME>/approvals, else ~/.paseo/approvals.
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const SOCK = path.join(
  process.env.PASEO_APPROVALS_DATA || path.join(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"), "approvals"),
  "hub.sock",
);

// Resolves with the hub's reply, or { ok: false, error } when it is not running or does not answer in time.
export function call(op, args = {}, { agentId = process.env.PASEO_AGENT_ID, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const c = net.createConnection(SOCK);
    let buf = "";
    const t = setTimeout(() => { c.destroy(); resolve({ ok: false, error: "Approvals did not answer in time" }); }, timeoutMs);
    c.on("connect", () => c.write(JSON.stringify({ op, agentId, args }) + "\n"));
    c.on("data", (d) => (buf += d));
    c.on("end", () => { clearTimeout(t); try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: "bad reply" }); } });
    c.on("error", () => { clearTimeout(t); resolve({ ok: false, error: "Approvals is not running" }); });
  });
}
