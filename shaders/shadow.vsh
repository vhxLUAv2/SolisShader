#version 330 compatibility

const int shadowMapResolution = 1024; // [512 1024 2048 4096]
const float shadowDistance = 80.0; // [48.0 64.0 80.0 96.0 128.0]

out vec2 texcoord;
out vec4 vertexColor;

void main() {
    gl_Position = ftransform();
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    vertexColor = gl_Color;
}
