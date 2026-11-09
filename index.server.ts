import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { DISMISS, SKIP, TIMELINE_KIND, answerCard, cardImage, clearHistory, listCards, mirrored, restoreCard } from "./shared/cards";
import { loadAdapters } from "./server/adapters";
import { attachAgents } from "./server/agents";
import { createHub } from "./server/hub";
import { createPush } from "./server/push";
import { createStore } from "./server/store";

const log = (o: object) => console.log(JSON.stringify(o));

export default function contribute(server: PluginServerContext) {
  const store = createStore(log);
  const push = createPush(log);
  const agents = attachAgents(server, store, log);
  let rpcApi: PaseoApi | null = null;
  const getApi = () => agents.getApi() ?? rpcApi;
  const hub = createHub(store, push, getApi, log);
  hub.start();
  const adapters = loadAdapters(hub, store, log);

  // Mirror agent cards into that agent's chat; the same row id is re-appended when the card changes.
  const offMirror = store.onChange((c) => {
    const api = getApi();
    if (!mirrored(c)) return;
    if (!api) return log({ kind: "mirror_skipped", why: "no_sdk_yet", card: c.id });
    void api.agents.ref(c.agentId!).timeline
      .append({ type: "plugin", id: `approvals-${c.id}`, kind: TIMELINE_KIND, version: 1, data: { card: store.strip(c) } })
      .catch((e: Error) => log({ kind: "error", where: "mirror", e: String(e?.message ?? e).slice(0, 160) }));
  });

  server.handle(listCards, ({ historyLimit }, { paseo }) => {
    rpcApi = paseo;
    return store.list(historyLimit ?? 100);
  });

  server.handle(answerCard, async ({ id, optionId, answers }, { paseo }) => {
    rpcApi = paseo;
    const c = store.get(id);
    if (!c || (c.status !== "open" && c.status !== "dismissed")) return { ok: false, error: "Already handled." };
    if (optionId === SKIP) return store.dismiss(id) ? { ok: true } : { ok: false, error: "Already set aside." };
    try {
      // Ask cards own their option ids, "open" and "dismiss" included.
      if (c.kind === "ask") {
        if (!optionId) return { ok: false, error: "No option picked." };
        const error = await hub.answer(c, optionId);
        return error ? { ok: false, error } : { ok: true };
      }
      if (optionId === DISMISS || optionId === "open") {
        store.close(id, "done", optionId === "open" ? "Opened" : "Dismissed");
        return { ok: true };
      }
      if (c.kind === "reply" || c.kind === "permission" || c.kind === "question") {
        if (!c.agentId) return { ok: false, error: "No agent on this card." };
        const error = await agents.answer(c, optionId, answers, paseo);
        return error ? { ok: false, error } : { ok: true };
      }
      store.close(id, "done", "Dismissed");
      return { ok: true };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 200);
      log({ kind: "error", where: "answer", card: c.kind, e: msg });
      return { ok: false, error: msg };
    }
  });

  server.handle(cardImage, ({ id }) => ({ dataUri: store.get(id)?.hasImage ? store.readImage(id) : null }));
  server.handle(restoreCard, ({ id }) => (store.restore(id) ? { ok: true } : { ok: false, error: "That card was already answered or expired." }));
  server.handle(clearHistory, () => { store.clearHistory(); return { ok: true }; });

  return () => {
    offMirror();
    void adapters.then((stop) => stop());
    hub.stop();
    agents.cleanup();
  };
}
