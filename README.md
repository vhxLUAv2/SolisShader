# Solis AFK Bot

A Minecraft Java Edition 26.3 AFK bot with two modes: the original low-memory protocol-client AFK mode (`npm start`) and a separate autonomous schematic-builder mode (`npm run build`). The builder uses Mineflayer physics/world tracking and pathfinding, so it needs more memory than the AFK-only mode.

## Defaults

The bot connects to `myawesomeserverwithf.falix.gg:25565` as `bot`, using offline-mode authentication and Minecraft `26.3`. It jumps at randomized intervals of 20–28 seconds and retries after a disconnect, waiting 10 seconds by default.

The server must accept offline-mode players. The bot does not change server settings or bypass bans, whitelists, account authentication, or connection limits. Use it only on a server where you are allowed to keep an AFK client connected.

## Bot-Hosting.net setup

1. Stop the server process.
2. Set the startup file to `index.js` for the original low-memory AFK mode.
3. Run `npm install --no-audit --no-fund` so dependencies for both AFK and schematic-builder modes are installed.
4. Start the server with `node index.js`. The server and username already have defaults in the code. Use `npm run build -- <file> <x> <y> <z>` in a shell-capable environment to run schematic builds; the panel must support command-line arguments for that mode.

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
| `AFK_JUMP_ENABLED` | `true` | Start with AFK jumping enabled; `false` keeps the client connected without jumping |
| `STATS_LOG_INTERVAL_SECONDS` | `0` | Optional runtime stats log interval; `0` disables periodic stats logs |
| `RECONNECT_DELAY_SECONDS` | `10` | Initial reconnect delay; increases after repeated failures |
| `RECONNECT_MAX_DELAY_SECONDS` | `120` | Maximum reconnect delay after repeated failures |
| `CONNECTION_WATCHDOG_SECONDS` | `120` | Reconnect if no server packets arrive for this long (30–900 seconds) |
| `DISCORD_WEBHOOK_URL` | empty | Optional Discord webhook for server online/offline alerts |
| `DISCORD_VERIFICATION_WEBHOOK_URL` | empty | Optional dedicated Discord webhook for Falix verification links |
| `DISCORD_BOT_TOKEN` | empty | Optional Discord bot token for restricted remote commands; keep secret |
| `DISCORD_COMMAND_CHANNEL_ID` | empty | Discord text channel where remote commands are accepted |
| `DISCORD_ALLOWED_USER_IDS` | empty | Comma-separated Discord user IDs allowed to issue commands |
| `BUILD_MAX_BLOCKS` | `50000` | Maximum non-air blocks accepted in one schematic build |
| `BUILD_BLOCK_ATTEMPTS` | `3` | Maximum placement attempts per block before it is reported unresolved |
| `BUILD_MAX_PASSES` | `4` | Maximum complete placement/recheck passes for neighbor-dependent blocks |
| `BUILD_DELAY_MS` | `250` | Delay between placement operations in milliseconds (minimum 50) |
| `BUILD_STATE_FILE` | `./build-state.json` | Local file used to save build progress |

The bot requests a view distance of 2 and minimal particles. Its lightweight movement loop sends protocol movement/input packets, a tick-end packet, and a position heartbeat every 20 ticks. It does not retain incoming chunks or track other entities. Reconnect attempts use exponential backoff, starting at `RECONNECT_DELAY_SECONDS` and capping at `RECONNECT_MAX_DELAY_SECONDS`; the retry counter resets after a connection stays joined for 60 seconds. A connection watchdog checks incoming protocol traffic and closes a silent connection after `CONNECTION_WATCHDOG_SECONDS`, allowing the normal reconnect path to recover. The watchdog is a network-silence check, not a guarantee that the Minecraft server itself is healthy.

## Discord verification alerts

Set `DISCORD_WEBHOOK_URL` to an incoming webhook for server online/offline status alerts, and set `DISCORD_VERIFICATION_WEBHOOK_URL` to a second incoming webhook in the channel where you want Falix verification links. Player chat is no longer mirrored to Discord. When a Falix link or a URL shortly after a verification prompt appears in game chat, the bot sends that link and a short message excerpt only to the dedicated verification webhook. If `DISCORD_VERIFICATION_WEBHOOK_URL` is unset, the detected link is logged to the hosting console rather than sent to Discord. Keep both webhook URLs secret and do not commit real values to GitHub. The bot sends status embeds to the status webhook when a connection first becomes available, is lost, or comes back after a disconnect. Since a disconnect cannot prove whether the server was stopped, restarted, or affected by network trouble, offline alerts say this explicitly. Duplicate verification links are suppressed for the current process. The bot only detects and forwards verification links; it does not open links or complete verification.

## Discord remote commands

Remote controls are optional and disabled unless `DISCORD_BOT_TOKEN`, `DISCORD_COMMAND_CHANNEL_ID`, and `DISCORD_ALLOWED_USER_IDS` are all configured. Create a Discord application/bot, invite it to your server with permission to view the chosen channel and send messages, and enable the Message Content intent in the Developer Portal. Use the bot token only in your hosting panel's secret environment settings; never commit it. The command handler accepts requests only from the configured channel and listed user IDs, ignores bot messages, and supports `!solis help`, `!solis status`, `!solis stats`, `!solis pause`, `!solis resume`, and `!solis jump`. It does not execute arbitrary commands or relay Minecraft/player chat. `pause` stops scheduled AFK jumps but leaves the Minecraft connection running; `jump` requests a jump when grounded. The implementation uses Node.js's built-in WebSocket and fetch APIs, with no additional dependency. Set `STATS_LOG_INTERVAL_SECONDS` to a positive value to print periodic uptime and connection statistics in the hosting console; status webhook embeds also include current process uptime and connection counts.

## RAM settings

The local `npm start` command caps the V8 old-space heap at 128 MB. If the hosting panel launches `node index.js` directly, set `NODE_OPTIONS=--max-old-space-size=128` in the panel's environment variables to apply the same heap limit there. This limits the JavaScript heap, not total process RAM. Do not set a heap cap above your hosting plan's memory budget.

If the server has a non-default port, set `MC_PORT` in the panel. If the server rejects protocol 26.3 or the connection is kicked, check the exact server version and its offline-mode/idle rules. Protocol compatibility and live joining still need testing on the target server.


## Autonomous schematic builder (experimental)

This mode is separate from `npm start`. It uses the Minecraft 26.3-capable Mineflayer fork, pathfinding, and Nucleation for Sponge `.schem` and Litematica `.litematic` parsing.

### Where to put your schematic

Create a `schematics` folder in the repository root, beside `package.json`, and put your file there. Keep the actual schematic file on your own machine or host; schematic files are ignored by Git so you do not accidentally commit large or private builds.

Example folder layout:

```text
SolisShader/
├─ package.json
├─ build-schematic.js
├─ .env
└─ schematics/
   ├─ house.litematic
   └─ tower.schem
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force .\schematics
Copy-Item "$HOME\Downloads\house.litematic" .\schematics\
npm install
npm run build -- .\schematics\house.litematic 100 64 100
```

Or use a Sponge schematic:

```powershell
npm run build -- .\schematics\tower.schem 100 64 100
```

The three numbers are the world coordinates added to each local schematic coordinate. For example, `100 64 100` means the schematic's local origin is placed at world X=100, Y=64, Z=100. Make sure the target area is one where the bot is allowed to build.

### Creative mode and block placement

The builder does not change the bot's game mode. The server must already have this bot in Creative mode and allow creative inventory-slot updates. When that API is available, the builder generates the required block/item stacks as needed; you do **not** need to preload every material. Fluids and a small number of blocks use a different item than their block ID, and some block IDs have no directly placeable item, so those may still be unresolved.

The builder compares the full block-state properties exposed by the schematic, preserves the chosen view angle when the Mineflayer placement API supports it, and tests yaw candidates for directional and 16-step rotation blocks. Logs/pillars prioritize the requested axis; slabs and stairs try side-face placements for top/bottom halves. It defers bed heads, door upper halves, and several two-block plants to the lower/foot block that creates them automatically. Chest connection types, rail shapes, stair shapes, fences/panes/walls, and other neighbor-derived states are kept in place for bounded follow-up passes instead of being immediately destroyed. This improves orientation and connected structures but is not a universal state setter; some properties depend on redstone, fluid, neighboring blocks, or block-specific interaction rules.

Pathfinding can dig ordinary route obstructions; the builder can also remove a wrong solid block at a schematic target coordinate to make room. **Use a disposable area/world first:** target-position blocks that do not match the schematic can be destroyed.

Block entities are mapped using their schematic coordinates. Inventories exposed as an `Items` list are compared slot-by-slot, unwanted existing stacks in those container slots are cleared, missing stacks are added, and the bot's hotbar is restored after temporary transfers. The builder rechecks them on resume instead of trusting only a saved container checkpoint. Still, this is not byte-for-byte block-entity restoration: custom modern item components and some unusual item NBT may be reported unresolved; sign text, banner patterns, spawner data, command-block data, and every specialized block entity are not written back generically. Double containers and unusual containers need in-game testing.

### Progress, limits, and current caveats

Progress is saved to `BUILD_STATE_FILE` after successful placements, including which container inventories have been restored. A checkpoint is reused only for the same schematic file, file hash, and origin. Live world blocks are still checked before a saved block is skipped, so missing or incorrectly oriented blocks can be repaired on a subsequent run. On disconnect, the builder saves state and reconnects.

The default schematic limit is `BUILD_MAX_BLOCKS=50000`; the builder uses a 512 MB V8 heap cap rather than the AFK mode's 128 MB cap. `BUILD_BLOCK_ATTEMPTS` bounds per-block retries, and `BUILD_MAX_PASSES` bounds full rechecks. Reduce the block limit for small hosting plans and increase `BUILD_DELAY_MS` if the server is laggy. Stop with `Ctrl+C`; progress remains saved.

The code passes syntax/install CI, but a real Minecraft 26.3 build test is still required. The builder is experimental. Exact state reproduction and container NBT fidelity depend on the block's in-game placement rules and what the server permits the client to do.
