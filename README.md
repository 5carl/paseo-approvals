# Approvals for Paseo

One inbox in the Paseo app for everything that needs you: agent replies, permission prompts, questions, and approvals from any script or agent on the machine. Cards come one at a time, answered ones go to History, and your phone gets a push for anything Paseo does not already tell you about.

Approvals does not know about your services. It gives you a generic `ask` (a title, some buttons, a timeout) and four ways to send one. Whatever is specific to your setup (a password manager, a payment flow, a deploy pipeline) stays in your own adapter or script.

## Install

    git clone https://github.com/5carl/paseo-approvals
    cd paseo-approvals && npm install
    paseo plugin install "$PWD"

Needs Paseo 0.12 or later. Reply cards read the predicted-reply line from [tech-bought-my-soul](https://github.com/5carl/tech-bought-my-soul), installed as a dependency.

## Where things live

All from the daemon's environment, nothing hard-coded:

| | Default | Override |
|---|---|---|
| Cards, images, socket, config | `<PASEO_HOME>/approvals` | `PASEO_APPROVALS_DATA` |
| Paseo home (push tokens) | `~/.paseo` | `PASEO_HOME` |
| Daemon address (tab screenshots) | `127.0.0.1:6767` | `PASEO_LISTEN`, plus `PASEO_PASSWORD` if set |

Scripts find the socket the same way, so set `PASEO_HOME` in their environment if your daemon uses a custom home.

## Asking

### From an agent (MCP)

    claude mcp add approvals -- node /path/to/paseo-approvals/bin/mcp.mjs

Tools: `ask_owner` (title, body, options, timeout_minutes, image_path, url; blocks until you tap) and `notify_owner`. Inside a Paseo agent the card links to that agent's chat and shows up there too.

### From a script (CLI)

    bin/approvals.mjs ask "Deploy build 512 to prod?" --body "3 migrations" && ./deploy.sh
    bin/approvals.mjs ask "Which region?" --option us-east --option eu-west --timeout 300
    bin/approvals.mjs notify "Backup finished" --source backups
    id=$(bin/approvals.mjs ask "Restock?" --no-wait); bin/approvals.mjs result "$id" --wait

`ask` prints the label you tapped. With the default Approve / Deny it exits 0 only on Approve; on expiry it prints `expired` and exits 3.

### Over the socket

`<data>/hub.sock`, mode 600. Send one JSON line, read one back:

    {"op": "ask", "agentId": "<optional Paseo agent id>", "args": {
      "title": "Deploy to prod?",
      "body": "markdown, optional",
      "detail": "monospace block, optional",
      "options": [{"id": "go", "label": "Deploy", "tone": "primary"}, {"id": "no", "label": "Cancel", "tone": "danger"}],
      "icon": "Rocket", "label": "Deploy", "tone": "warning",
      "timeoutSec": 600, "wait": true,
      "imagePath": "/tmp/diff.png", "url": "https://ci.example/512",
      "push": {"title": "CI", "body": "Build 512 is ready"},
      "key": "deploy-512", "source": "ci", "mirror": true
    }}
    -> {"ok": true, "id": "...", "status": "done", "answer": "go", "label": "Deploy"}

Only `title` is required. No options means Approve (`approve`) / Deny (`deny`). `icon` is any [lucide](https://lucide.dev/icons) name, `tone` is accent, warning, danger, success or muted. `key` stops duplicates while one is open. `push: false` skips the phone push. `mirror: false` keeps the card out of the agent's chat. `timeoutSec` runs from 10 seconds to 24 hours, default 10 minutes. Without `wait` you get the id back at once.

Other ops:

| op | args | does |
|---|---|---|
| `result` | `id`, `wait` | status and answer of a card, optionally waiting for it to close |
| `close` | `id`, `answer` | close a card you opened because the thing it asked about went away |
| `notify` | `text`, `title`, `source`, `imagePath`, `push` | an FYI card |
| `send_image` | `browserId` or `path`, `caption` | an image card from a Paseo agent (needs `agentId`) |
| `share_tab` | `url`, `browserId`, `note`, `minutes` | a card that opens a link, usually a shared browser tab (needs `agentId`) |

Waiting callers get `"status": "expired"` if the plugin restarts while they wait.

### Adapters

For asks that need code on the answer side, like calling a local service when you tap Allow or picking up requests from a folder. An adapter is a module the plugin loads at start; it can open cards, react to taps, and add its own socket ops. List it in `<data>/config.json`:

    { "adapters": ["~/my-approvals/adapter.mjs"] }

See [ADAPTERS.md](ADAPTERS.md).

## Develop

    npm run typecheck && paseo plugin reload paseo-approvals && paseo plugin logs paseo-approvals

## License

MIT
