#version 330 compatibility

// Shader-pack menu setting; profiles can override this constant.
#define ENABLE_TERRAIN_TINT 1 // [0 1]

uniform sampler2D gtexture;
uniform sampler2D lightmap;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 vertexColor;
in vec3 normalView;

/* DRAWBUFFERS:0123 */
void main() {
    vec4 albedo = texture(gtexture, texcoord) * vertexColor;
    if (albedo.a < 0.1) {
        discard;
    }

    vec3 light = texture(lightmap, lmcoord).rgb;
    vec3 lit = albedo.rgb * light;

    #if ENABLE_TERRAIN_TINT == 1
    // Subtle warmth; Minecraft's lightmap remains the main light source.
    lit *= vec3(1.018, 1.008, 0.990);
    #endif

    gl_FragData[0] = vec4(lit, albedo.a);
    // UVs let later passes distinguish blocklight from sky-light influence.
    gl_FragData[1] = vec4(clamp(lmcoord.xy, 0.0, 1.0), 0.0, 1.0);
    gl_FragData[2] = vec4(normalize(normalView) * 0.5 + 0.5, 1.0);
    // Red is a water-material mask; opaque terrain writes zero.
    gl_FragData[3] = vec4(0.0);
}
