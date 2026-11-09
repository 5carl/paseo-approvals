// Where things live. Everything comes from the daemon's own environment, so nothing here is tied to one machine.
//   PASEO_HOME            daemon home (push tokens), default ~/.paseo
//   PASEO_APPROVALS_DATA  cards, images, the hub socket and config.json, default <PASEO_HOME>/approvals
//   PASEO_LISTEN          daemon address, used to screenshot an agent's tab; PASEO_PASSWORD if the daemon has one
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PASEO_HOME = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
export const DATA = process.env.PASEO_APPROVALS_DATA || path.join(PASEO_HOME, "approvals");
export const SOCK = path.join(DATA, "hub.sock");
export const IMAGES = path.join(DATA, "images");

export const PASEO_BIN = process.env.PASEO_BIN
  || ["/opt/homebrew/bin/paseo", "/usr/local/bin/paseo"].find((p) => fs.existsSync(p))
  || "paseo";

export function daemonUrl() {
  const m = (process.env.PASEO_LISTEN || "").match(/^(?:([\w.-]+):)?(\d+)$/);
  const host = !m?.[1] || m[1] === "0.0.0.0" ? "127.0.0.1" : m[1];
  return `http://${host}:${m?.[2] || "6767"}`;
}

// <DATA>/config.json, all optional:
//   { "adapters": ["~/my-approvals/adapter.mjs"] }   modules loaded at start, see ADAPTERS.md
export type Config = { adapters?: string[] };
export function readConfig(): Config {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8")); } catch { return {}; }
}

export const expandHome = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());
