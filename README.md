# Solis AFK Bot

A small Minecraft Java Edition 26.3 AFK jumper intended for low-storage and low-memory hosting panels. It uses the Minecraft protocol client directly instead of Mineflayer, so it does not keep a world, chunk, block, inventory, or entity model in memory.

## Defaults

The bot connects to `myawesomeserverwithf.falix.gg:25565` as `bot`, using offline-mode authentication and Minecraft `26.3`. It jumps at randomized intervals of 20–28 seconds and retries after a disconnect, waiting 10 seconds by default.

The server must accept offline-mode players. The bot does not change server settings or bypass bans, whitelists, account authentication, or connection limits. Use it only on a server where you are allowed to keep an AFK client connected.

## Bot-Hosting.net setup

1. Stop the server process.
2. Delete the existing `node_modules` directory once to remove the failed/old Mineflayer installation and free its disk space. Keep `package.json` and `bot.js`.
3. Set the startup file to `bot.js`.
4. Start the server. The panel can run `npm install --no-fund --no-audit` and then `node bot.js`; both the server and username already have defaults in the code.

The server address and bot name are already set, so a `.env` file is not required on the hosting panel. To override the defaults, set the variables below in the panel's environment settings.

## Local setup

Requires Node.js 22 or newer. In the repository directory:

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
| `RECONNECT_DELAY_SECONDS` | `10` | Reconnect delay |
| `DISCORD_WEBHOOK_URL` | empty | Optional Discord incoming webhook URL |

The bot requests a view distance of 2 and minimal particles. Its lightweight movement loop sends protocol movement/input packets, a tick-end packet, and a position heartbeat every 20 ticks. It does not retain incoming chunks or track other entities.

## Discord verification alerts

Create an incoming webhook in your Discord channel, then set `DISCORD_WEBHOOK_URL` in the Bot-Hosting.net environment variables. Keep the webhook URL secret and do not commit the real value to GitHub. When a Falix link or a URL shortly after a verification prompt appears in game chat, the bot posts the link and a short message excerpt to Discord. Duplicate links are suppressed for the current process. This only forwards the alert; it does not open links or complete verification.

## RAM settings

The local `npm start` command caps the V8 old-space heap at 128 MB. If the hosting panel launches `node bot.js` directly, set `NODE_OPTIONS=--max-old-space-size=128` in the panel's environment variables to apply the same heap limit there. This limits the JavaScript heap, not total process RAM. Do not set a heap cap above your hosting plan's memory budget.

If the server has a non-default port, set `MC_PORT` in the panel. If the server rejects protocol 26.3 or the connection is kicked, check the exact server version and its offline-mode/idle rules. Protocol compatibility and live joining still need testing on the target server.
