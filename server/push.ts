// Phone push for cards that do not come from Paseo's own attention events (asks, tabs, images, alerts).
// Reuses the Expo tokens the Paseo app registered with the daemon (<paseo home>/push-tokens.json), and the
// same data shape Paseo sends, so a tap opens the related agent.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PASEO_BIN, PASEO_HOME } from "./config";
import type { StoredCard } from "./store";

const EXPO = "https://exp.host/--/api/v2/push/send";

export function createPush(log: (o: object) => void = () => {}) {
  let serverId: string | null = null;
  execFile(PASEO_BIN, ["daemon", "status", "--json"], { timeout: 15000 }, (err, out) => {
    if (err) return log({ kind: "push_no_server_id" });
    try { serverId = JSON.parse(out).serverId ?? null; } catch {}
  });

  function tokens(): string[] {
    try {
      const subs = JSON.parse(fs.readFileSync(path.join(PASEO_HOME, "push-tokens.json"), "utf8")).subscriptions ?? [];
      const now = Date.now();
      return subs.filter((s: { token?: string; expiresAt?: string }) => s?.token && Date.parse(s.expiresAt ?? "") > now).map((s: { token: string }) => s.token);
    } catch { return []; }
  }

  async function send(c: StoredCard, title: string, body: string) {
    const to = tokens();
    if (to.length === 0) return;
    const data: Record<string, string> = {};
    if (serverId) data.serverId = serverId;
    if (c.workspaceId) data.workspaceId = c.workspaceId;
    if (c.agentId) data.agentId = c.agentId;
    try {
      const r = await fetch(EXPO, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(to.map((t) => ({ to: t, title: title.slice(0, 120), body: body.slice(0, 300), data, sound: "default" }))),
      });
      log({ kind: "push", ok: r.ok, card: c.kind });
    } catch (e) {
      log({ kind: "push_failed", e: String((e as Error)?.message ?? e).slice(0, 100) });
    }
  }
  return { send };
}
