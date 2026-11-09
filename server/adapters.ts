// Adapters: your own modules, loaded in the plugin's process, for asks that need code on the answer side
// (call a local service when the owner taps Allow, poll a folder for requests, add a socket op).
// List them in <data>/config.json as { "adapters": ["/abs/path/adapter.mjs"] }. See ADAPTERS.md.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATA, expandHome, readConfig } from "./config";
import type { AnswerHandler, AskInput, Hub, Op, Who } from "./hub";
import type { Store, StoredCard } from "./store";

export type AdapterApi = {
  /** A private folder for this adapter: <data>/adapters/<name>. */
  dataDir: string;
  log(o: object): void;
  ask(input: AskInput, opts?: { agentId?: string; priv?: Record<string, unknown>; wait?: boolean; onAnswer?: AnswerHandler }): Promise<StoredCard>;
  /** Resolves with the tapped option id, or "expired" / "cleared". */
  wait(cardId: string): Promise<string>;
  close(cardId: string, answer: string, status?: "done" | "expired" | "cleared"): boolean;
  notify(input: { text: string; title?: string; source?: string; imagePath?: string; push?: boolean }): StoredCard;
  /** Re-attach a tap handler, for example to cards still open from before a reload. */
  onAnswer(cardId: string, handler: AnswerHandler): void;
  /** Open and set-aside cards matching pred. */
  find(pred: (c: StoredCard) => boolean): StoredCard[];
  /** Add a socket op; callers send {"op": name, "agentId", "args"}. */
  addOp(name: string, op: Op): void;
  agentInfo(agentId: string): Promise<Who | null>;
};
type Cleanup = void | (() => void | Promise<void>);
type Adapter = (api: AdapterApi) => Cleanup | Promise<Cleanup>;

export async function loadAdapters(hub: Hub, store: Store, log: (o: object) => void) {
  const cleanups: (() => void | Promise<void>)[] = [];
  for (const raw of readConfig().adapters ?? []) {
    const file = path.resolve(DATA, expandHome(raw));
    const name = path.basename(file).replace(/\.[^.]+$/, "");
    const alog = (o: object) => log({ adapter: name, ...o });
    const offs: (() => void)[] = [];
    try {
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
      const fn: Adapter = mod.default;
      if (typeof fn !== "function") throw new Error("no default export function");
      const dataDir = path.join(DATA, "adapters", name);
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const api: AdapterApi = {
        dataDir,
        log: alog,
        ask: (input, o = {}) => hub.ask(input, o.agentId, { priv: o.priv, blocking: o.wait, onAnswer: o.onAnswer }),
        wait: (id) => store.wait(id),
        close: (id, answer, status = "done") => store.close(id, status, answer),
        notify: (input) => hub.notify(input),
        onAnswer: (id, h) => { hub.onAnswer(id, h); },
        find: (pred) => store.find(pred),
        addOp: (n, op) => { offs.push(hub.addOp(n, op)); },
        agentInfo: (id) => hub.agentInfo(id),
      };
      const done = await fn(api);
      cleanups.push(async () => { offs.forEach((off) => off()); if (typeof done === "function") await done(); });
      alog({ kind: "adapter_loaded" });
    } catch (e) {
      offs.forEach((off) => off());
      alog({ kind: "error", where: "adapter_load", e: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return async () => { for (const c of cleanups) await Promise.resolve(c()).catch(() => {}); };
}
