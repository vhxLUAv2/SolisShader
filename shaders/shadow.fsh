#version 330 compatibility

uniform sampler2D gtexture;
in vec2 texcoord;
in vec4 vertexColor;

void main() {
    // Preserve cutout holes in leaves and other alpha-tested terrain.
    float alpha = texture(gtexture, texcoord).a * vertexColor.a;
    if (alpha < 0.1) {
        discard;
    }
}
