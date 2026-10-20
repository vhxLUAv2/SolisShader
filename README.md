# Stone Brick Trapdoor Helper

A minimal Fabric **client-side** mod for Minecraft Java 26.2.

## Multiplayer/server behavior

The mod does **not** require a mod installed on the server. It attempts placement through Minecraft's normal client interaction path, which syncs the selected hotbar slot and sends a standard use-on-block interaction to the connected server.

The server remains authoritative: it validates placement, reach, protection, and game rules. A server plugin or anti-cheat that prohibits automated placement can still reject the action. This mod does not bypass server checks.

## Behavior

- Scans every three client ticks for a full `minecraft:stone_bricks` block directly above the player's current bounding box.
- If a spruce trapdoor is in the hotbar and the space immediately below the stone bricks is replaceable, it attempts to place the trapdoor against the underside.
- Uses a 20-tick cooldown to avoid spamming interaction attempts on servers where placement is rejected.
- Temporarily selects the hotbar slot containing the trapdoor and restores the previous selection after a short delay, unless the player manually changes slots.
- Does not rearrange the main inventory and does not act while a GUI is open.

Only the vanilla full block `minecraft:stone_bricks` triggers it. Stairs, slabs, walls, cracked stone bricks, and other variants do not.

## Install

1. Install Fabric Loader for Minecraft Java 26.2.
2. Install a matching Fabric API release.
3. Download the `stone-brick-trapdoor` JAR from the successful GitHub Actions build artifact.
4. Put the JAR in your Minecraft `.minecraft/mods` folder and launch the Fabric 26.2 profile. The server does not need this mod installed.

## Build

Requirements: JDK 25 and Gradle 9.5.1.

Run from the repository root:

```sh
gradle build
```

The mod JAR is output to `build/libs/`. GitHub Actions builds on pushes and pull requests to `main`, and can also be started manually from the Actions tab.

## Limitations

This helper sends ordinary block-placement interactions. It cannot force a server to accept a placement that violates server rules, protection plugins, reach checks, or anti-cheat policies. It has not yet been tested in a live multiplayer server.
