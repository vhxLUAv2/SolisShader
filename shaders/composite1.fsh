#version 330 compatibility

#define ENABLE_VOLUMETRICS 1 // [0 1]
#define ENABLE_CAUSTICS 1 // [0 1]
//#define ENABLE_XRAY // Reveal ores through terrain without distance fog
#define VOLUMETRIC_STEPS 4 // [3 4 6 8 12]
#define FOG_DENSITY 0.006 // [0.003 0.004 0.006 0.008 0.010]

uniform sampler2D colortex0;
uniform sampler2D depthtex0;
uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferProjection;
uniform mat4 gbufferModelViewInverse;
uniform vec3 cameraPosition;
uniform vec3 sunPosition;
uniform vec3 fogColor;
uniform float viewWidth;
uniform float viewHeight;
uniform float frameTimeCounter;
uniform float rainStrength;
uniform int isEyeInWater;

in vec2 texcoord;

vec3 unprojectView(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = gbufferProjectionInverse * clip;
    return view.xyz / max(abs(view.w), 0.00001) * sign(view.w);
}

/* DRAWBUFFERS:0 */
void main() {
    vec4 color = texture(colortex0, texcoord);
    float depth = texture(depthtex0, texcoord).r;
    vec3 fogLinear = pow(max(fogColor, vec3(0.0)), vec3(2.2));

    vec3 viewRay;
    if (depth >= 0.999999) {
        vec4 farClip = gbufferProjectionInverse * vec4(texcoord * 2.0 - 1.0, 1.0, 1.0);
        viewRay = normalize(farClip.xyz / max(abs(farClip.w), 0.00001));
        vec3 worldRay = normalize(mat3(gbufferModelViewInverse) * viewRay);
        vec3 sunDirWorld = normalize(mat3(gbufferModelViewInverse) * normalize(sunPosition));
        float horizon = pow(1.0 - clamp(worldRay.y, 0.0, 1.0), 1.35);
        vec3 zenithColor = vec3(0.035, 0.095, 0.22);
        vec3 horizonColor = mix(vec3(0.60, 0.40, 0.26), fogLinear, 0.48);
        vec3 skyTint = mix(horizonColor, zenithColor, smoothstep(-0.10, 0.55, worldRay.y));
        float sunGlow = pow(max(dot(worldRay, sunDirWorld), 0.0), 48.0);
        skyTint += vec3(1.0, 0.58, 0.28) * sunGlow * 0.30;
        color.rgb = mix(color.rgb, skyTint, 0.12 * (0.25 + 0.75 * horizon));
        viewRay = normalize(viewRay);
    } else {
        vec3 viewPos = unprojectView(texcoord, depth);
        vec3 playerPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz;

        #ifndef ENABLE_XRAY
            float distanceToPixel = length(viewPos);
            float worldHeight = cameraPosition.y + playerPos.y;
            float altitudeDensity = exp(-clamp(worldHeight - 62.0, -40.0, 180.0) * 0.007);
            float weatherDensity = mix(FOG_DENSITY, FOG_DENSITY * 2.7, clamp(rainStrength, 0.0, 1.0));
            float fogAmount = 1.0 - exp(-distanceToPixel * weatherDensity * altitudeDensity);
            vec3 sunDirView = normalize(sunPosition);
            float phase = pow(max(dot(normalize(viewPos), sunDirView), 0.0), 10.0);
            vec3 scatteringColor = mix(fogLinear, vec3(1.0, 0.70, 0.42), phase * 0.22);
            color.rgb = mix(color.rgb, scatteringColor, clamp(fogAmount, 0.0, 0.88));
        #endif

        #if ENABLE_CAUSTICS == 1
        if (isEyeInWater != 0) {
            vec2 p = playerPos.xz * 0.145;
            float t = frameTimeCounter * 0.34;
            float pattern = sin(p.x * 2.0 + sin(p.y * 1.6 + t) + t) *
                            sin(p.y * 2.2 - sin(p.x * 1.4 - t * 0.8));
            float caustic = pow(abs(pattern), 6.0);
            color.rgb *= 1.0 + caustic * 0.13;
        }
        #endif
    }

    #if ENABLE_VOLUMETRICS == 1
        vec4 sunClip = gbufferProjection * vec4(sunPosition, 1.0);
        vec2 sunUv = sunClip.xy / max(abs(sunClip.w), 0.0001) * 0.5 + 0.5;
        vec2 boundedSunUv = clamp(sunUv, vec2(0.0), vec2(1.0));
        vec2 rayDelta = (boundedSunUv - texcoord) / float(VOLUMETRIC_STEPS);
        float lightShafts = 0.0;
        float sunInFront = step(0.001, sunClip.w);
        for (int i = 0; i < VOLUMETRIC_STEPS; i++) {
            vec2 sampleUv = clamp(texcoord + rayDelta * (float(i) + 0.5), vec2(0.001), vec2(0.999));
            float sampleDepth = texture(depthtex0, sampleUv).r;
            float visibleSky = smoothstep(0.995, 1.0, sampleDepth);
            float weight = 1.0 - float(i) / float(VOLUMETRIC_STEPS);
            lightShafts += visibleSky * weight;
        }
        vec3 worldSun = normalize(mat3(gbufferModelViewInverse) * normalize(sunPosition));
        float sunUp = smoothstep(-0.08, 0.18, worldSun.y);
        float shaftStrength = lightShafts / float(VOLUMETRIC_STEPS) * sunUp * sunInFront * 0.055;
        color.rgb += vec3(1.0, 0.76, 0.50) * shaftStrength;
    #endif

    gl_FragData[0] = color;
}
