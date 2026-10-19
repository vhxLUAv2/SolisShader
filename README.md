# Solis AFK Bot

A lightweight Minecraft Java Edition 26.3 client whose only in-game behavior is randomized AFK jumping. It uses the Minecraft protocol directly instead of loading chunks or tracking other entities.

## Defaults

The bot connects to `myawesomeserverwithf.falix.gg:25565` as `bot`, using offline-mode authentication and Minecraft `26.3`. It jumps at randomized intervals of 20–28 seconds and retries after a disconnect.

The server must accept offline-mode players. The bot does not change server settings or bypass bans, whitelists, account authentication, or connection limits. Use it only on a server where you are allowed to keep an AFK client connected.

## Bot-Hosting.net setup

1. Stop the process.
2. Keep `index.js` as the startup file.
3. Use this startup command: `npm start`.
4. Let npm install the small dependency set from `package.json`.

The server address and bot name are already set, so a `.env` file is not required. To override defaults, set environment variables in the hosting panel.

## Local setup

Requires Node.js 22 or newer.

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Run `npm run check` to check JavaScript syntax.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MC_HOST` | `myawesomeserverwithf.falix.gg` | Server hostname |
| `MC_PORT` | `25565` | Java server port |
| `MC_USERNAME` | `bot` | Offline-mode username |
| `MC_VERSION` | `26.3` | Minecraft protocol version |
| `JUMP_MIN_SECONDS` | `20` | Minimum interval between jumps |
| `JUMP_MAX_SECONDS` | `28` | Maximum interval between jumps |
| `RECONNECT_DELAY_SECONDS` | `10` | Initial reconnect delay; increases after repeated failures |
| `RECONNECT_MAX_DELAY_SECONDS` | `120` | Maximum reconnect delay |
| `CONNECTION_WATCHDOG_SECONDS` | `120` | Reconnect if no server packets arrive for this long (30–900 seconds) |

The bot requests a view distance of 2 and minimal particles. Its movement loop sends protocol movement/input packets and a position heartbeat every 20 ticks. It does not retain incoming chunks or track other entities. Reconnect attempts use exponential backoff, and a connection watchdog closes a silent connection so the normal reconnect path can recover.

The local `npm start` command caps the V8 old-space heap at 128 MB. If the hosting panel launches Node directly, set `NODE_OPTIONS=--max-old-space-size=128` in the panel. This limits the JavaScript heap, not total process RAM.

Protocol compatibility and live joining still need testing on the target server.
