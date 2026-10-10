# SolisShader

SolisShader is a performance-aware Minecraft Java shader pack for the classic Iris/OptiFine GLSL pipeline. It aims for a cinematic look without defaulting to the most expensive effects.

## Visual features

- Soft PCF shadow-map filtering with quality presets.
- Minecraft lightmap-aware terrain shading and subtle warm color grading.
- Gentle vegetation wrap-lighting approximation.
- Animated water normal perturbation, optional screen-space reflections, and underwater caustic highlights.
- Altitude-aware distance fog, sky tinting, and screen-space sun shafts.
- Four-tap highlight bloom, ACES-style tonemapping, and a lightweight sky-light-informed exposure lift.
- Optional depth-of-field and camera-motion blur in the Ultra preset.

## X-ray

Enable **ENABLE_XRAY** in Shader Pack Settings → Visuals to show mapped vanilla ores through ordinary terrain. X-ray temporarily removes terrain distance fog and lights the remaining ore surfaces so they are visible underground. It is off by default in all presets. The mapping includes coal, copper, iron, gold, redstone, emerald, lapis, diamond, nether quartz/gold ores, and ancient debris. This affects the terrain program; entities, particles, and some non-solid or cutout layers may still appear normally.

## Fullbright

Toggle **ENABLE_FULLBRIGHT** in Shader Pack Settings → Visuals to render terrain and water without Minecraft's block/sky lightmap and to skip this pack's shadow darkening on those pixels. It is off by default in all three presets, so you can enable it separately. Atmospheric and distance fog remain active. The toggle currently covers terrain and water programs, not every entity, first-person hand, or particle.

## Presets

- **Low:** minimal post-processing, SSR, DOF, and motion blur disabled for higher frame rates.
- **Medium:** 1024 shadow map, four-tap PCF, four-tap bloom, four volumetric taps, fog and caustics. SSR and blur remain off.
- **Ultra:** 2048 shadow map, nine-tap PCF, bounded 8-step shafts/SSR, DOF and motion blur. This preset costs more GPU time.

No fixed FPS can be guaranteed. GPU model alone does not determine performance; resolution, render distance, scene geometry, drivers, other mods, and Minecraft settings matter.

## Direct download

[**Download the repository ZIP directly from GitHub**](https://github.com/vhxLUAv2/SolisShader/archive/refs/heads/main.zip). No GitHub Actions are required.

1. Download and extract the ZIP.
2. Move the extracted `SolisShader-main` folder into the Minecraft `shaderpacks` folder opened from Iris' Shader Packs screen.
3. Select SolisShader from the shader list. The repository archive is a source snapshot, so use the extracted folder rather than selecting the repository ZIP itself.

## Notes and compatibility

This pack uses the conventional `shaders/` layout and GLSL 330 compatibility shaders. Iris documents `composite`, `composite1`, and `final` as fullscreen post-processing programs. Some features are visual approximations: SSR only reflects objects visible in the current frame; the leaf/grass effect is not physically accurate subsurface scattering; exposure is an environment-light lift rather than histogram-based temporal exposure.

The source uses compile-time option switches so disabled effects can be removed from shader variants where supported. In-game rendering on a particular Iris/OptiFine version and GPU still needs to be verified.
