Everything that needs you, as one stack of cards in the Paseo app. Answer the top card and the next one slides up. Answered cards move to History.

## Cards

- **Reply**: an agent finished and its reply ends with predicted replies (the [tech-bought-my-soul](https://github.com/5carl/tech-bought-my-soul) line). Tapping one sends it to that agent.
- **Permission**: any agent wants to run a command, edit a file, or start a plan. Allow or Deny, or the provider's own options.
- **Question**: an agent asked a multiple choice question. Tap an answer.
- **Ask**: anything a script, agent or adapter asks you, with its own buttons, icon and color. Deploys, purchases, logins, whatever your setup needs.
- **Tab**: an agent needs you to act in a shared browser tab. Open tab goes straight to it.
- **Image and FYI**: screenshots from agents and alerts from local scripts.

Cards close themselves when you answer in the chat instead, when the agent moves on, or when they expire. Cards that Paseo does not already notify you about also send a phone push through the Paseo app.

## Ask from anywhere

- **Agents**: add the bundled MCP server and they get `ask_owner` and `notify_owner`.
- **Scripts**: `bin/approvals.mjs ask "Deploy to prod?" && ./deploy.sh`
- **Anything else**: one JSON line on a local unix socket.
- **Adapters**: your own module, loaded by the plugin, for asks that need code when you tap (call a local service, poll a folder).

See the README for setup and ADAPTERS.md for the adapter API.
