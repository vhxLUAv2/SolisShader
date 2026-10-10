# SolisShader

SolisShader is a minimal, source-first shader pack for Minecraft Java Edition using the Iris/OptiFine shader-pack format.

## Current features

- Terrain texturing with Minecraft's lightmap preserved.
- A restrained warm color adjustment.
- A lightweight composite pass with mild contrast, saturation, and vignette adjustments.
- No external shader libraries or downloaded assets.

This is a starter shader pack, not a physically based or feature-heavy shader. It does not currently implement custom shadows, waving foliage, volumetric lighting, reflections, or custom water.

## Install

1. Download `SolisShader.zip` from the **Artifacts** section of a successful GitHub Actions run.
2. Keep the ZIP file compressed.
3. In Minecraft Java Edition, open the shader-pack folder from the Iris Shader Packs screen.
4. Put `SolisShader.zip` in that folder and select SolisShader.

Iris must be installed. Compatibility depends on the Minecraft, Iris, graphics driver, and GPU versions in use.

## Source layout

- `shaders/gbuffers_terrain.vsh` — terrain vertex stage
- `shaders/gbuffers_terrain.fsh` — terrain fragment stage
- `shaders/composite.vsh` — fullscreen composite vertex stage
- `shaders/composite.fsh` — final color adjustment

## Build and validation

GitHub Actions checks the expected source files and basic shader structure, then creates `SolisShader.zip` and uploads it as a workflow artifact. This automated check is not a substitute for launching Minecraft and testing the pack in-game.
