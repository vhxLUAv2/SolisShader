# Solis Crop-Farming Bot

A Minecraft Java 26.3 AFK bot with crop farming. It uses the Minecraft-aware `@wp2508/mineflayer` fork for block, inventory, digging, planting, and movement state. Farming is limited to a configured rectangular crop layer and does not craft tools, refill water, fertilize crops, or automatically sell/deposit produce.

## Default connection

The bot connects to `myawesomeserverwithf.falix.gg:25565` as `bot`, using offline-mode authentication and Minecraft `26.3`. If farming is not enabled, it jumps at randomized intervals of 20–28 seconds and retries after a disconnect, waiting 10 seconds by default.

The server must accept offline-mode players. The bot does not bypass bans, whitelists, account authentication, or connection limits. Use it only on a server where you are allowed to connect.

## Configure crop farming

1. Place the bot near the farm and make sure it can walk to the crop plot.
2. In Minecraft chat, set the crop-block layer using the two opposite corners. For example: `#farm area 100 64 200 108 208`. This scans X/Z coordinates 100–108 and 200–208 at Y=64; farmland is at Y=63. The area limit is 4,096 crop positions.
3. The bot begins farming after the area command. It harvests mature wheat, carrots, potatoes, and beetroot, then replants the same crop when it has the required seed/item. Empty farmland is planted with the selected default crop.
4. Use `#farm crop wheat`, `#farm crop carrots`, `#farm crop potatoes`, or `#farm crop beetroots` to choose what to plant in empty plots.
5. Use `#farm status`, `#farm stop`, and `#farm start` to check or control farming. The farm area and enabled state are saved in `.farm-region.json` and restored after restarts.

Commands:
- `#farm area <x1> <y> <z1> <x2> <z2>`
- `#farm crop <wheat|carrots|potatoes|beetroots>`
- `#farm start`
- `#farm stop`
- `#farm status`
- `#farm help`

Set `MC_OWNER_USERNAME` to a Minecraft username to restrict these commands to that player. If it is blank, any player whose chat the bot can read may issue farm commands. The bot needs seeds/items in its inventory to plant. If it cannot reach blocks, check that the farm is level, its rows are accessible, and the bot is near the configured area.

## Bot-Hosting.net setup

1. Stop the process.
2. Delete the existing `node_modules` directory to clear the previous protocol-only install, then install dependencies from this repository.
3. Set the startup file to `index.js`.
4. Run `npm install --no-audit --no-fund` then `node index.js`, or use `npm start`.

Mineflayer maintains loaded chunks, blocks, entities, and inventory, so it uses more memory and disk than the earlier protocol-only AFK client. The start script limits V8 old-space to 192 MB, but total process memory is higher. If the hosting plan is too small to load the dependencies or world chunks, the bot may be terminated by the host.

## Local setup

Requires Node.js 22.9 or newer. In the repository directory:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Run `npm run check` for a syntax check.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MC_HOST` | `myawesomeserverwithf.falix.gg` | Server hostname |
| `MC_PORT` | `25565` | Java server port |
| `MC_USERNAME` | `bot` | Offline-mode username (3–16 letters, digits, underscores) |
| `MC_OWNER_USERNAME` | empty | Optional username allowed to control farm commands |
| `MC_VERSION` | `26.3` | Minecraft version |
| `FARM_CROP` | `wheat` | Crop to plant in empty farmland |
| `JUMP_MIN_SECONDS` | `20` | Minimum AFK jump interval when not farming |
| `JUMP_MAX_SECONDS` | `28` | Maximum AFK jump interval when not farming |
| `RECONNECT_DELAY_SECONDS` | `10` | Reconnect delay |
| `DISCORD_WEBHOOK_URL` | empty | Discord webhook for player chat and server-status alerts |
| `DISCORD_VERIFICATION_WEBHOOK_URL` | empty | Dedicated Discord webhook for Falix verification links |

## Discord alerts

Set `DISCORD_WEBHOOK_URL` for player chat and server online/offline status alerts. Set `DISCORD_VERIFICATION_WEBHOOK_URL` to a separate webhook for Falix verification links. Keep webhook URLs secret. Player chat webhook names and avatars use each Minecraft username and its Minecraft-head image. Duplicate verification links are suppressed during a process run. The bot forwards verification links but does not open links or complete verification.

## Notes

- Farming supports wheat, carrots, potatoes, and beetroot crops on existing farmland.
- The bot only harvests mature crops. It does not till dirt, create a farm, refill water, craft seeds, eat food, protect itself, or deposit produce into a chest.
- Farm coordinates use Minecraft block coordinates. The configured Y is the crop block's Y level; farmland is directly below it.
- Actual farming and connection behavior still need testing on the target server, and server-side plugins can affect interactions.
