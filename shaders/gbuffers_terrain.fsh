#version 330 compatibility

uniform sampler2D gtexture;
uniform sampler2D lightmap;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 fragColor;

void main() {
    vec4 albedo = texture(gtexture, texcoord) * glcolor;
    if (albedo.a < 0.1) {
        discard;
    }

    vec3 light = texture(lightmap, lmcoord).rgb;
    vec3 color = albedo.rgb * light;

    // Subtle warm daylight tint without replacing Minecraft's lightmap.
    float daylight = clamp(lmcoord.y, 0.0, 1.0);
    color.r *= 1.025;
    color.g *= 1.010;
    color.b *= 0.985;
    color *= mix(0.92, 1.04, daylight);

    fragColor = vec4(color, albedo.a);
}
