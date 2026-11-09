# Adapters

An adapter is a JavaScript module the plugin loads when it starts, in the plugin's own process. Use one when an approval needs code when the owner taps: tell a local service the answer, watch a folder for requests, or offer a socket op with your own name and wording. Keep adapters outside this repo; they are where your setup lives.

## Load one

In `<data>/config.json` (default `<PASEO_HOME>/approvals/config.json`):

    { "adapters": ["~/my-approvals/deploys.mjs"] }

Relative paths resolve from the data folder. Reload with `paseo plugin reload paseo-approvals`. Load errors go to `paseo plugin logs paseo-approvals` and do not stop the plugin.

## Shape

    export default function (api) {
      // set things up
      return () => { /* clean up on reload */ };
    }

## The api

| | |
|---|---|
| `dataDir` | a private folder, `<data>/adapters/<file name>` |
| `log(obj)` | one JSON line in the plugin log |
| `ask(input, { agentId, priv, wait, onAnswer })` | open an ask card. `input` is the socket `ask` args. `priv` is kept on the server and never reaches a client. `wait` marks it as blocking (it expires if the plugin restarts). Returns the card |
| `wait(cardId)` | resolves with the tapped option id, or `"expired"` / `"cleared"` |
| `onAnswer(cardId, fn)` | `fn(optionId, card)` runs on a tap before the card closes. Return an error string to show it to the owner |
| `close(cardId, answer, status?)` | close a card; `status` is `done` (default), `expired` or `cleared` |
| `notify({ text, title, source, imagePath, push })` | an FYI card |
| `find(pred)` | open and set-aside cards, for re-attaching `onAnswer` after a reload |
| `addOp(name, fn)` | a socket op; `fn(args, agentId)` returns the reply object |
| `agentInfo(agentId)` | `{ agentId, workspaceId, agentTitle }` for a live Paseo agent, or null |

## Example: approve deploys from a queue folder

    import fs from "node:fs";
    import path from "node:path";

    const QUEUE = "/var/tmp/deploy-requests";

    export default function deploys(api) {
      const timer = setInterval(async () => {
        for (const f of fs.readdirSync(QUEUE).filter((f) => f.endsWith(".json"))) {
          const req = JSON.parse(fs.readFileSync(path.join(QUEUE, f), "utf8"));
          fs.rmSync(path.join(QUEUE, f));
          await api.ask(
            { title: `Deploy ${req.build} to ${req.env}?`, icon: "Rocket", label: "Deploy", tone: "warning", timeoutSec: 900,
              options: [{ id: "go", label: "Deploy" }, { id: "no", label: "Not now", tone: "danger" }] },
            { priv: { build: req.build }, onAnswer: async (id, card) => {
                if (id !== "go") return;
                const r = await fetch("http://127.0.0.1:9000/deploy", { method: "POST", body: JSON.stringify(card.priv) });
                if (!r.ok) return "The deploy service did not accept it.";
              } },
          );
        }
      }, 2000);
      return () => clearInterval(timer);
    }

## Example: a blocking op with your own wording

    export default function spend(api) {
      api.addOp("approve_spend", async (args, agentId) => {
        const card = await api.ask(
          { title: `Spend ${args.amount} at ${args.merchant}?`, icon: "CreditCard", label: "Spend", tone: "danger",
            options: [{ id: "yes", label: `Approve ${args.amount}` }, { id: "no", label: "Stop", tone: "danger" }] },
          { agentId, wait: true },
        );
        const answer = await api.wait(card.id);
        return { ok: answer === "yes", answer };
      });
    }

Callers then send `{"op": "approve_spend", "agentId": "...", "args": {"amount": "$12", "merchant": "..."}}`.
