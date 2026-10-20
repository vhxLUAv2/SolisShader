# Stone Brick Trapdoor Helper

A minimal Fabric **client-side** mod for Minecraft Java 26.2. This project now lives in the SolisShader repository.

## Behavior

- Checks every three client ticks for a full minecraft:stone_bricks block directly above the player's head (two blocks above the player's block position).
- If a spruce trapdoor is present in the hotbar and the block directly below the stone bricks is replaceable, it attempts to place the trapdoor against the underside of the stone bricks.
- Uses a short cooldown to avoid duplicate placement attempts while the client/server state catches up.
- Temporarily selects the hotbar slot containing the trapdoor and restores the previous selection shortly afterward, unless the player manually changes slots.
- Does not manipulate inventory slots outside the hotbar and does not act while a GUI is open.

The trigger is the vanilla full block minecraft:stone_bricks. Stone-brick stairs, slabs, walls, cracked stone bricks, and other variants are not included.

## Install

1. Install Fabric Loader for Minecraft Java 26.2.
2. Install the matching Fabric API release.
3. Download the stone-brick-trapdoor JAR from the successful GitHub Actions build artifact.
4. Put the JAR in your Minecraft mods folder and launch the Fabric 26.2 profile.

## Build

Requirements: JDK 25 and Gradle 9.5.1.

From the repository root, run:

    gradle build

The mod JAR is output to build/libs/. GitHub Actions builds on pushes and pull requests to main, and can also be started manually from the Actions tab.

## Limitations

This is a client-side interaction helper. It uses normal player block-placement interaction and does not bypass server permissions, reach checks, placement rules, or anti-cheat protections. It has not yet been verified in a live Minecraft client.
