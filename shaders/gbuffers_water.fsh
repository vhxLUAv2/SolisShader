#version 330 compatibility

#define ENABLE_WATER_WAVES 1 // [0 1]

uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform mat4 gbufferModelView;
uniform mat4 gbufferModelViewInverse;
uniform float frameTimeCounter;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 vertexColor;
in vec3 normalView;
in vec3 worldPosition;

/* DRAWBUFFERS:0123 */
void main() {
    vec4 albedo = texture(gtexture, texcoord) * vertexColor;
    vec3 light = texture(lightmap, lmcoord).rgb;
    vec3 waterColor = albedo.rgb * light;
    waterColor *= vec3(0.88, 1.015, 1.08);

    vec3 viewN = normalize(normalView);
    #if ENABLE_WATER_WAVES == 1
        // Low-cost, world-anchored normal perturbation; it does not displace geometry.
        float t = frameTimeCounter * 0.62;
        vec3 playerN = normalize(mat3(gbufferModelViewInverse) * viewN);
        vec3 waveSlope = vec3(
            0.19 * sin(worldPosition.z * 0.115 + t) +
            0.08 * sin((worldPosition.x + worldPosition.z) * 0.071 - t * 0.7),
            0.0,
            0.18 * cos(worldPosition.x * 0.103 - t * 0.8) +
            0.07 * cos((worldPosition.x - worldPosition.z) * 0.083 + t)
        );
    vec3 perturbedWorldN = normalize(playerN + waveSlope);
    viewN = normalize(mat3(gbufferModelView) * perturbedWorldN);
    #endif

    // Retain the alpha supplied by Minecraft so normal translucent blending still applies.
    float alpha = clamp(albedo.a, 0.0, 0.88);
    gl_FragData[0] = vec4(waterColor, alpha);
    gl_FragData[1] = vec4(clamp(lmcoord.xy, 0.0, 1.0), 0.0, 1.0);
    gl_FragData[2] = vec4(normalize(viewN) * 0.5 + 0.5, alpha);
    // With the regular translucent blend state, red becomes a soft water coverage mask.
    gl_FragData[3] = vec4(1.0, 0.0, 0.0, alpha);
}
