# SolisShader

A performance-aware shader pack for Minecraft Java Edition using the classic Iris/OptiFine GLSL shader-pack pipeline.

**Target version:** Minecraft Java Edition 26.2. The official release line uses the year-based name 26.2 rather than 1.26.2. Use a matching current Iris release; shader-loader and graphics-driver compatibility still needs in-game verification.

## Visual features

- PCF-filtered shadow-map sampling with a low-cost four-tap mode and a higher-quality nine-tap mode.
- Terrain lightmap preservation, subtle warm grading, and a restrained green-material wrap-lighting approximation.
- Screen-space water reflections (SSR), enabled in the Ultra profile. SSR is limited by what is visible in the current frame and can miss off-screen objects or sky.
- Animated world-anchored water-normal perturbation, plus procedural underwater caustic highlights.
- Height-aware atmospheric fog, a restrained sky tint, and screen-space light shafts toward the sun.
- Highlight bloom, an ACES-style filmic tone curve, lightmap-informed exposure compensation, optional depth-of-field blur, and optional camera-motion blur.

## Performance profiles

Open Shader Pack Settings and choose a profile:

- **Low:** 512 shadow map, four-tap shadows and expensive visual passes disabled.
- **Medium:** 1024 shadow map, four-tap shadows, fog, and bloom; SSR and blur disabled.
- **Ultra:** 2048 shadow map, nine-tap shadows, more volumetric steps, SSR, DOF, and camera-motion blur.

These are relative quality presets, not FPS guarantees. Actual performance depends on resolution, GPU, driver, scene complexity, other mods, and the shader loader. A GTX 1660 or RTX 3060 may perform differently across worlds; 100+ FPS cannot be promised without testing on the target setup.

## Download and install

**Direct download:** [Download SolisShader.zip from GitHub Releases](https://github.com/vhxLUAv2/SolisShader/releases/latest/download/SolisShader.zip).

1. Download `SolisShader.zip` using the direct link above.
2. Keep the ZIP compressed and place it in the shaderpacks folder opened from Iris' Shader Packs screen.
3. Select SolisShader in Minecraft.

Each successful push to `main` updates the latest GitHub Release download. Pull requests still validate and package the shader pack without publishing a release.

The artifact contains a top-level shaders folder, ready for the shader-pack loader.

## Source map

- shaders/gbuffers_terrain.vsh and .fsh — terrain color, lightmap coordinates, and view-space normals.
- shaders/gbuffers_water.vsh and .fsh — animated water normals and a material mask for SSR.
- shaders/shadow.vsh and .fsh — alpha-tested shadow-map geometry.
- shaders/composite.fsh — PCF shadows, vegetation-like wrap lighting, and optional SSR.
- shaders/composite1.fsh — altitude-aware fog, sky tint, god-ray approximation, and caustics.
- shaders/final.fsh — optional blur effects, bloom, exposure, tone mapping, and display transfer.
- shaders/shaders.properties — Low, Medium, and Ultra profiles plus settings menus.

## Validation limits

GitHub Actions checks required files, GLSL syntax where supported by glslangValidator, and ZIP structure. This does not emulate Minecraft's render pipeline. The shader pack has not been confirmed in-game on Minecraft 26.2, Iris, OptiFine, or a specific GPU; verify it with Iris shader debug mode before treating it as release-ready.

## Build artifact

Each push to main, pull request, or manual workflow dispatch validates and packages SolisShader.zip. The uploaded workflow artifact is retained for 30 days.
