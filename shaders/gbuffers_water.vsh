#version 330 compatibility

out vec2 texcoord;
out vec2 lmcoord;
out vec4 vertexColor;
out vec3 normalView;
out vec3 worldPosition;

uniform mat4 gbufferModelViewInverse;
uniform vec3 cameraPosition;

void main() {
    vec4 viewPosition = gl_ModelViewMatrix * gl_Vertex;
    vec3 playerPosition = (gbufferModelViewInverse * viewPosition).xyz;

    gl_Position = gl_ProjectionMatrix * viewPosition;
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
    vertexColor = gl_Color;
    normalView = normalize(gl_NormalMatrix * gl_Normal);
    worldPosition = cameraPosition + playerPosition;
}
