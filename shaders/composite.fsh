#version 330 compatibility

uniform sampler2D colortex0;
in vec2 texcoord;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 fragColor;

void main() {
    vec4 scene = texture(colortex0, texcoord);
    vec3 color = max(scene.rgb, vec3(0.0));

    // Gentle contrast curve.
    color = (color * (2.0 * color + 0.025)) /
            (color * (2.0 * color + 0.35) + 0.08);

    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, 1.06);

    vec2 centered = texcoord * 2.0 - 1.0;
    float vignette = 1.0 - 0.08 * dot(centered, centered);
    color *= clamp(vignette, 0.88, 1.0);

    fragColor = vec4(clamp(color, 0.0, 1.0), scene.a);
}
