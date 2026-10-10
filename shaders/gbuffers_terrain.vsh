#version 330 compatibility

// Shader option kept identical across the stages that use it.
//#define ENABLE_XRAY // Reveal ores through terrain without distance fog

// Iris/OptiFine supplies this attribute when shaders/block.properties is present.
attribute vec4 mc_Entity;

out float blockId;
out vec2 texcoord;
out vec2 lmcoord;
out vec4 vertexColor;
out vec3 normalView;

void main() {
    gl_Position = ftransform();
    blockId = mc_Entity.x;
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
    vertexColor = gl_Color;
    normalView = normalize(gl_NormalMatrix * gl_Normal);
}
