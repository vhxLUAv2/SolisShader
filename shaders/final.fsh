#version 330 compatibility

const bool ENABLE_BLOOM = true;
const bool ENABLE_ADAPTIVE_EXPOSURE = true;
const bool ENABLE_DOF = false;
const bool ENABLE_MOTION_BLUR = false;
const int MOTION_BLUR_SAMPLES = 4;
const float BLOOM_STRENGTH = 0.095;

uniform sampler2D colortex0;
uniform sampler2D depthtex0;
uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferModelViewInverse;
uniform mat4 gbufferPreviousModelView;
uniform mat4 gbufferPreviousProjection;
uniform vec3 cameraPosition;
uniform vec3 previousCameraPosition;
uniform ivec2 eyeBrightnessSmooth;
uniform float centerDepthSmooth;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

vec3 acesApprox(vec3 x) {
    // Fitted ACES filmic curve; inexpensive component-wise rational approximation.
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 brightPass(vec2 uv) {
    vec3 sampleColor = max(texture(colortex0, uv).rgb, vec3(0.0));
    float luminance = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
    return sampleColor * smoothstep(0.70, 1.45, luminance);
}

vec3 unprojectView(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = gbufferProjectionInverse * clip;
    return view.xyz / max(abs(view.w), 0.00001) * sign(view.w);
}

void main() {
    vec3 color = max(texture(colortex0, texcoord).rgb, vec3(0.0));
    vec2 pixel = 1.0 / vec2(max(viewWidth, 1.0), max(viewHeight, 1.0));
    float depth = texture(depthtex0, texcoord).r;

    if (ENABLE_DOF && depth < 0.999999) {
        float focus = clamp(centerDepthSmooth, 0.0, 1.0);
        float radius = clamp(abs(depth - focus) * 90.0, 0.0, 3.0);
        vec2 offset = pixel * radius;
        vec3 blur = color;
        blur += texture(colortex0, clamp(texcoord + vec2(offset.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
        blur += texture(colortex0, clamp(texcoord - vec2(offset.x, 0.0), vec2(0.001), vec2(0.999))).rgb;
        blur += texture(colortex0, clamp(texcoord + vec2(0.0, offset.y), vec2(0.001), vec2(0.999))).rgb;
        blur += texture(colortex0, clamp(texcoord - vec2(0.0, offset.y), vec2(0.001), vec2(0.999))).rgb;
        float amount = smoothstep(0.002, 0.035, abs(depth - focus)) * 0.22;
        color = mix(color, blur * 0.2, amount);
    }

    if (ENABLE_MOTION_BLUR && depth < 0.999999) {
        vec3 viewPos = unprojectView(texcoord, depth);
        vec3 playerPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz;
        vec3 worldPos = cameraPosition + playerPos;
        vec3 previousPlayerPos = worldPos - previousCameraPosition;
        vec4 previousView = gbufferPreviousModelView * vec4(previousPlayerPos, 1.0);
        vec4 previousClip = gbufferPreviousProjection * previousView;
        vec2 previousUv = previousClip.xy / max(abs(previousClip.w), 0.0001) * 0.5 + 0.5;
        vec2 velocity = clamp(texcoord - previousUv, vec2(-0.025), vec2(0.025));
        vec3 blur = vec3(0.0);
        for (int i = 0; i < MOTION_BLUR_SAMPLES; i++) {
            float t = (float(i) + 0.5) / float(MOTION_BLUR_SAMPLES);
            vec2 sampleUv = clamp(texcoord - velocity * t, vec2(0.001), vec2(0.999));
            blur += texture(colortex0, sampleUv).rgb;
        }
        float amount = clamp(length(velocity) * 20.0, 0.0, 0.30);
        color = mix(color, blur / float(MOTION_BLUR_SAMPLES), amount);
    }

    if (ENABLE_BLOOM) {
        vec3 bloom = vec3(0.0);
        bloom += brightPass(texcoord + pixel * vec2( 2.0,  0.0));
        bloom += brightPass(texcoord + pixel * vec2(-2.0,  0.0));
        bloom += brightPass(texcoord + pixel * vec2( 0.0,  2.0));
        bloom += brightPass(texcoord + pixel * vec2( 0.0, -2.0));
        bloom += brightPass(texcoord + pixel * vec2( 3.0,  3.0));
        bloom += brightPass(texcoord + pixel * vec2(-3.0,  3.0));
        bloom += brightPass(texcoord + pixel * vec2( 3.0, -3.0));
        bloom += brightPass(texcoord + pixel * vec2(-3.0, -3.0));
        color += bloom * (BLOOM_STRENGTH / 8.0);
    }

    if (ENABLE_ADAPTIVE_EXPOSURE) {
        float localSkyLight = clamp(float(eyeBrightnessSmooth.y) / 240.0, 0.0, 1.0);
        float caveLift = 1.0 - localSkyLight;
        color *= 1.0 + caveLift * 0.17;
    }

    color = acesApprox(color);

    // Gentle corner falloff, kept subtle to avoid crushing the image.
    vec2 centered = texcoord * 2.0 - 1.0;
    float vignette = clamp(1.0 - 0.045 * dot(centered, centered), 0.92, 1.0);
    color *= vignette;

    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    gl_FragColor = vec4(color, 1.0);
}
