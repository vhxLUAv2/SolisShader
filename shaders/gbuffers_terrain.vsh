#version 330 compatibility

// Vertex-stage cost is kept intentionally small.
out vec2 texcoord;
out vec2 lmcoord;
out vec4 vertexColor;
out vec3 normalView;

void main() {
    gl_Position = ftransform();
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
    vertexColor = gl_Color;
    normalView = normalize(gl_NormalMatrix * gl_Normal);
}
