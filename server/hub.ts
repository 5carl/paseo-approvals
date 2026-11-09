// Cards from outside agent turns, all through one unix socket (<data>/hub.sock, mode 600, one JSON line in, one out).
// A request is {"op": "...", "agentId"?: "...", "args": {...}}. Built-in ops:
//   ask         any question with buttons; "wait": true blocks until a tap or the timeout  -> ask card, push
//   result      an ask's state by id; "wait": true blocks until it closes
//   close       close a card you opened (the thing it asked about went away)
//   notify      an alert with no answer                                                     -> fyi card, push
//   send_image  a file or an agent's tab screenshot                                         -> image card, push
//   share_tab   a link the owner should open, usually a shared browser tab                  -> tab card, push
// Adapters (see ADAPTERS.md) add their own ops next to these.
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { APPROVE, DENY, DISMISS, cardTone, type CardOption, type CardStyle } from "../shared/cards";
import { PASEO_BIN, SOCK, daemonUrl, expandHome } from "./config";
import type { Store, StoredCard } from "./store";

const IMAGE_MAX = 15 * 1024 * 1024;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const DEFAULT_ASK_S = 10 * 60;
const MAX_ASK_S = 24 * 60 * 60;
export const clean = (t: unknown, n: number) => String(t ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, n).trim();

export type Push = { send(c: StoredCard, title: string, body: string): Promise<void> };
export type Args = Record<string, unknown>;
export type Op = (a: Args, agentId: string) => Promise<object>;
export type Who = { agentId?: string; workspaceId?: string; agentTitle?: string };
// Runs when the owner taps a button on that card, before it closes. Return an error string to keep it open and show it.
export type AnswerHandler = (optionId: string, card: StoredCard) => Promise<string | null | void>;

export type AskInput = {
  title: string;
  body?: string;
  detail?: string;
  options?: { id?: string; label: string; tone?: CardOption["tone"] }[];
  icon?: string;
  label?: string;
  tone?: CardStyle["tone"];
  source?: string;
  timeoutSec?: number;
  key?: string;
  url?: string;
  browserId?: string;
  fullPage?: boolean;
  imagePath?: string;
  push?: false | { title?: string; body?: string };
  mirror?: boolean;
};

// A tab screenshot taken as the calling agent (the daemon only shows an agent its own workspace's tabs).
async function screenshotTab(agentId: string, browserId: string, fullPage = false) {
  const url = `${daemonUrl()}/mcp/agents?callerAgentId=${encodeURIComponent(agentId)}`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (process.env.PASEO_PASSWORD) headers.authorization = `Bearer ${process.env.PASEO_PASSWORD}`;
  const post = (b: object) => fetch(url, { method: "POST", headers, body: JSON.stringify(b) }).then((r) => r.text());
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "approvals", version: "1" } } });
  const t = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "browser_screenshot", arguments: { browserId, fullPage } } });
  const line = t.split("\n").find((l) => l.startsWith("data: "));
  const r = line ? JSON.parse(line.slice(6)).result : null;
  const img = r?.content?.find((c: { type: string }) => c.type === "image");
  if (!img?.data) throw new Error(r?.structuredContent?.error?.message || "the browser did not return a screenshot");
  return { buf: Buffer.from(img.data, "base64"), mime: String(img.mimeType || "image/png") };
}

// An image file the owner may see: only png/jpg/gif/webp under the home folder or a temp folder.
function readImageFile(raw: string): { buf: Buffer; mime: string } | { error: string } {
  const p = path.resolve(expandHome(raw));
  const mime = MIME[path.extname(p).toLowerCase()];
  if (!mime) return { error: "Only png, jpg, gif or webp files." };
  if (![os.homedir() + path.sep, "/tmp/", "/private/tmp/", os.tmpdir()].some((d) => p.startsWith(d))) return { error: "The file must be under the home folder or a temp folder." };
  const buf = fs.readFileSync(p);
  return buf.length > IMAGE_MAX ? { error: "Image is over 15 MB." } : { buf, mime };
}

export function createHub(store: Store, push: Push, getApi: () => PaseoApi | null, log: (o: object) => void) {
  const handlers = new Map<string, AnswerHandler>();

  async function agentInfo(agentId: string): Promise<Who | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(agentId)) return null;
    const api = getApi();
    if (api) {
      try {
        const ref = api.agents.ref(agentId);
        await ref.refresh();
        const snap: any = ref.current();
        if (snap?.id) return { agentId, workspaceId: snap.workspaceId ?? undefined, agentTitle: clean(snap.title || snap.cwd?.split("/").pop() || `Agent ${agentId.slice(0, 8)}`, 60) };
      } catch {}
    }
    // No SDK handle yet (no hook or RPC since the plugin started): ask the CLI.
    return new Promise<Who | null>((resolve) => {
      execFile(PASEO_BIN, ["inspect", agentId, "--json"], { timeout: 15000 }, (err, out) => {
        try {
          const i = JSON.parse(out);
          resolve(!err && i?.Id && !i.Archived ? { agentId, workspaceId: undefined, agentTitle: clean(i.Title || i.Name || `Agent ${agentId.slice(0, 8)}`, 60) } : null);
        } catch { resolve(null); }
      });
    });
  }

  async function attachShot(c: StoredCard, agentId: string, browserId: unknown, fullPage = false) {
    if (!browserId || !agentId) return;
    try { const { buf, mime } = await screenshotTab(agentId, String(browserId), fullPage); store.saveImage(c.id, buf, mime); c.hasImage = true; store.touch(c); }
    catch (e) { log({ kind: "error", where: "screenshot", e: String((e as Error).message).slice(0, 120) }); }
  }

  // Open an ask card. Throws on bad input. priv is server-only data the caller wants back later (ids, nonces).
  async function ask(a: AskInput, agentId = "", extra: { priv?: Record<string, unknown>; blocking?: boolean; onAnswer?: AnswerHandler } = {}): Promise<StoredCard> {
    const title = clean(a.title, 200);
    if (!title) throw new Error("ask needs a title");
    const given = Array.isArray(a.options) ? a.options.slice(0, 6) : [];
    const options: CardOption[] = given.length
      ? given.map((o, i) => ({
          id: clean(o?.id, 64) || `o${i}`,
          label: clean(o?.label, 60) || `Option ${i + 1}`,
          tone: o?.tone === "primary" || o?.tone === "secondary" || o?.tone === "danger" ? o.tone : i === 0 ? "primary" : "secondary",
        }))
      : [{ id: APPROVE, label: "Approve", tone: "primary" }, { id: DENY, label: "Deny", tone: "danger" }];
    if (new Set(options.map((o) => o.id)).size !== options.length) throw new Error("option ids must be unique");
    const who: Who = (agentId && (await agentInfo(agentId))) || { agentTitle: clean(a.source, 60) || undefined };
    const tone = cardTone.safeParse(a.tone).success ? a.tone : undefined;
    const style: CardStyle = { icon: clean(a.icon, 40) || undefined, label: clean(a.label, 40) || undefined, tone };
    const secs = Math.min(Math.max(Number(a.timeoutSec) || DEFAULT_ASK_S, 10), MAX_ASK_S);
    const url = clean(a.url, 500);
    let image: { buf: Buffer; mime: string } | null = null;
    if (a.imagePath) {
      const r = readImageFile(String(a.imagePath));
      if ("error" in r) throw new Error(r.error);
      image = r;
    }
    const id = store.newId();
    if (image) store.saveImage(id, image.buf, image.mime);
    const c = store.add({
      id, ...who, kind: "ask", key: clean(a.key, 200) || undefined, title, body: clean(a.body, 4000) || undefined, detail: clean(a.detail, 4000) || undefined,
      style, options, url: /^https?:\/\//.test(url) ? url : undefined, hasImage: !!image, expiresAt: Date.now() + secs * 1000,
      mirror: a.mirror, priv: { ...extra.priv, ...(extra.blocking ? { blocking: true } : {}) },
    });
    if (extra.onAnswer) handlers.set(c.id, extra.onAnswer);
    if (a.browserId && who.agentId) await attachShot(c, who.agentId, a.browserId, !!a.fullPage);
    if (a.push !== false) void push.send(c, clean(a.push?.title, 120) || who.agentTitle || style.label || "Approvals", clean(a.push?.body, 300) || title);
    return c;
  }

  function result(c: StoredCard) {
    const label = c.options.find((o) => o.id === c.answerId)?.label;
    return { ok: true, id: c.id, status: c.status, answer: c.status === "done" ? c.answerId ?? null : null, ...(label ? { label } : {}) };
  }

  function notify(a: { text: string; title?: string; source?: string; imagePath?: string; push?: boolean }) {
    const text = clean(a.text, 3000);
    if (!text) throw new Error("no text");
    const title = clean(a.title, 80) || text.split("\n")[0].slice(0, 80);
    const id = store.newId();
    let hasImage = false;
    if (a.imagePath) {
      const r = readImageFile(a.imagePath);
      if ("error" in r) throw new Error(r.error);
      store.saveImage(id, r.buf, r.mime);
      hasImage = true;
    }
    const c = store.add({ id, kind: "fyi", title, body: text === title ? undefined : text, hasImage, options: [{ id: DISMISS, label: "Got it", tone: "secondary" }], agentTitle: clean(a.source, 40) || undefined });
    if (a.push !== false) void push.send(c, title, text === title ? "" : text);
    return c;
  }

  const ops: Record<string, Op> = {
    async ask(a, agentId) {
      const wait = a.wait === true;
      const c = await ask(a as unknown as AskInput, agentId, { blocking: wait });
      if (!wait) return { ok: true, id: c.id };
      await store.wait(c.id);
      return result(store.get(c.id)!);
    },

    async result(a) {
      const c = store.get(clean(a.id, 64));
      if (!c) return { ok: false, error: "no such card" };
      if (a.wait === true) await store.wait(c.id);
      return result(store.get(c.id)!);
    },

    async close(a) {
      const id = clean(a.id, 64);
      return store.close(id, "cleared", clean(a.answer, 200) || "Closed by the sender") ? { ok: true } : { ok: false, error: "no open card with that id" };
    },

    async notify(a) {
      // "path" is the older name for imagePath.
      const c = notify({ text: String(a.text ?? ""), title: a.title as string, source: a.source as string, imagePath: (a.imagePath ?? a.path) as string | undefined, push: a.push !== false });
      return { ok: true, id: c.id };
    },

    async send_image(a, agentId) {
      const who = await agentInfo(agentId);
      if (!who) return { ok: false, error: "Only Paseo agents can send images here." };
      const id = store.newId();
      let img: { buf: Buffer; mime: string };
      if (a.browserId) img = await screenshotTab(agentId, String(a.browserId), !!a.fullPage);
      else if (a.path) {
        const r = readImageFile(String(a.path));
        if ("error" in r) return { ok: false, error: r.error };
        img = r;
      } else return { ok: false, error: "Pass browserId (a tab to screenshot) or path (an image file)." };
      if (img.buf.length > IMAGE_MAX) return { ok: false, error: "Image is over 15 MB." };
      store.saveImage(id, img.buf, img.mime);
      const caption = clean(a.caption, 500) || "Image";
      const c = store.add({ id, ...who, kind: "image", title: caption, hasImage: true, options: [{ id: DISMISS, label: "Got it", tone: "secondary" }] });
      void push.send(c, who.agentTitle ?? "Image", caption);
      return { ok: true, message: "Shown to the owner in Approvals." };
    },

    async share_tab(a, agentId) {
      const who = await agentInfo(agentId);
      if (!who) return { ok: false, error: "Only Paseo agents can share tabs here." };
      const url = clean(a.url, 500);
      if (!/^https?:\/\//.test(url)) return { ok: false, error: "bad url" };
      const minutes = Math.min(Math.max(Number(a.minutes) || 30, 1), 240);
      const note = clean(a.note, 500) || "Do a step in this tab, then tap Done there.";
      const c = store.add({ ...who, key: `tab:${agentId}:${a.browserId}`, kind: "tab", title: note, url, expiresAt: Date.now() + minutes * 60000, options: [{ id: "open", label: "Open tab", tone: "primary" }, { id: DISMISS, label: "Dismiss", tone: "secondary" }] });
      await attachShot(c, agentId, a.browserId);
      void push.send(c, `${who.agentTitle} needs you in a tab`, note);
      return { ok: true, message: "Shown to the owner in Approvals." };
    },
  };

  function addOp(name: string, op: Op) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error(`bad op name: ${name}`);
    if (ops[name]) throw new Error(`op already exists: ${name}`);
    ops[name] = op;
    return () => { if (ops[name] === op) delete ops[name]; };
  }

  // The owner tapped an ask card. Returns an error string, or null when it went through.
  async function answer(c: StoredCard, optionId: string): Promise<string | null> {
    const h = handlers.get(c.id);
    if (h) {
      const err = await h(optionId, c);
      if (err) return err;
      handlers.delete(c.id);
    }
    const label = c.options.find((o) => o.id === optionId)?.label ?? optionId;
    store.close(c.id, "done", label, optionId);
    return null;
  }

  let server: net.Server | null = null;
  let timer: NodeJS.Timeout | null = null;
  function start() {
    try { fs.unlinkSync(SOCK); } catch {}
    server = net.createServer((conn) => {
      let buf = "";
      conn.on("data", async (d) => {
        buf += d;
        if (buf.length > 65536) return conn.destroy();
        const i = buf.indexOf("\n");
        if (i < 0) return;
        let req: any;
        try { req = JSON.parse(buf.slice(0, i)); } catch { return conn.end('{"ok":false,"error":"bad request"}\n'); }
        let res: object;
        try {
          const op = Object.hasOwn(ops, String(req.op)) ? ops[String(req.op)] : null;
          res = op ? await op(req.args || {}, String(req.agentId || "")) : { ok: false, error: "unknown op" };
        } catch (e) {
          res = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
          log({ kind: "error", where: `hub_${req.op}`, e: String((e as Error)?.message ?? e).slice(0, 160) });
        }
        if (!conn.destroyed) conn.end(JSON.stringify(res) + "\n");
      });
      conn.on("error", () => {});
    });
    server.listen(SOCK, () => { try { fs.chmodSync(SOCK, 0o600); } catch {} });
    timer = setInterval(() => {
      store.sweep();
      for (const id of handlers.keys()) { const c = store.get(id); if (!c || (c.status !== "open" && c.status !== "dismissed")) handlers.delete(id); }
    }, 2000);
  }
  function stop() {
    if (timer) clearInterval(timer);
    try { server?.close(); } catch {}
    try { fs.unlinkSync(SOCK); } catch {}
  }
  return { start, stop, ask, notify, answer, addOp, agentInfo, attachShot, onAnswer: (id: string, h: AnswerHandler) => handlers.set(id, h) };
}
export type Hub = ReturnType<typeof createHub>;
