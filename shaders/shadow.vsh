#version 330 compatibility

const int shadowMapResolution = 1024;
const float shadowDistance = 96.0;

out vec2 texcoord;
out vec4 vertexColor;

void main() {
    gl_Position = ftransform();
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    vertexColor = gl_Color;
}
