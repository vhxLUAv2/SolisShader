# Solis AFK Bot

A lightweight Minecraft Java Edition AFK bot for servers that permit offline-mode players. It joins with a configurable username, makes a short jump at a randomized interval, and reconnects after disconnects.

## Requirements

- Node.js 22.9 or newer
- A Minecraft Java Edition 26.3 server that accepts offline-mode connections
- Permission from the server owner to keep a bot connected

## Setup

1. Install Node.js.
2. Clone or download this repository.
3. In this directory, copy `.env.example` to `.env`.
4. Edit `.env` and set your server address and the bot username.
5. Run:

```sh
npm install
npm start
```

On Windows PowerShell, copy the settings file with:

```powershell
Copy-Item .env.example .env
```

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `MC_HOST` | `127.0.0.1` | Server IP or hostname |
| `MC_PORT` | `25565` | Java server port |
| `MC_USERNAME` | `SolisAFKBot` | Offline-mode player name |
| `MC_VERSION` | `26.3` | Minecraft protocol version |
| `JUMP_MIN_SECONDS` | `20` | Minimum delay between jumps |
| `JUMP_MAX_SECONDS` | `28` | Maximum delay between jumps |
| `RECONNECT_DELAY_SECONDS` | `10` | Delay before reconnecting |

The bot only jumps when it is on the ground. It does not walk around, send chat messages, or interact with blocks. Jump timing is randomized within the configured range.

## Server requirements

The server must already allow offline-mode connections. The bot uses offline authentication; it does not change the server's `online-mode` setting, whitelist, or permissions. Offline-mode usernames are not authenticated by Microsoft, so only use this on a server you control or are authorized to join.

## Troubleshooting

- Confirm `MC_HOST` and `MC_PORT` match the Java server address.
- Ensure the server accepts offline-mode players and that the configured username is not already online.
- If the server rejects Minecraft 26.3, check the server software and protocol compatibility before changing `MC_VERSION`.
- The bot reconnects after ordinary disconnects, but it cannot bypass bans, whitelist restrictions, or server-side connection limits.

## Validate

Run `npm run check` to check the bot's JavaScript syntax.
