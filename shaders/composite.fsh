#version 330 compatibility

const bool ENABLE_SHADOWS = true;
const bool ENABLE_SSR = false;
const int SHADOW_QUALITY = 1; // 1 = four taps, 2 = nine taps
const int SSR_STEPS = 6;

uniform sampler2D colortex0;
uniform sampler2D colortex1;
uniform sampler2D colortex2;
uniform sampler2D colortex3;
uniform sampler2D depthtex0;
uniform sampler2D shadowtex0;

uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferProjection;
uniform mat4 gbufferModelViewInverse;
uniform mat4 shadowModelView;
uniform mat4 shadowProjection;
uniform vec3 shadowLightPosition;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

vec3 unprojectView(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = gbufferProjectionInverse * clip;
    return view.xyz / max(abs(view.w), 0.00001) * sign(view.w);
}

float compareShadow(vec2 uv, float depth, float bias) {
    return step(depth - bias, texture(shadowtex0, uv).r);
}

float filteredShadow(vec3 shadowCoord, vec3 normal, vec3 lightDir) {
    if (any(lessThan(shadowCoord.xy, vec2(0.001))) ||
        any(greaterThan(shadowCoord.xy, vec2(0.999))) ||
        shadowCoord.z <= 0.0 || shadowCoord.z >= 1.0) {
        return 1.0;
    }

    vec2 texel = vec2(1.0 / float(shadowMapResolution));
    float bias = max(0.00025, 0.0011 * (1.0 - max(dot(normal, lightDir), 0.0)));
    float sum = 0.0;

    if (SHADOW_QUALITY <= 1) {
        sum += compareShadow(shadowCoord.xy + texel * vec2(-0.5, -0.5), shadowCoord.z, bias);
        sum += compareShadow(shadowCoord.xy + texel * vec2( 0.5, -0.5), shadowCoord.z, bias);
        sum += compareShadow(shadowCoord.xy + texel * vec2(-0.5,  0.5), shadowCoord.z, bias);
        sum += compareShadow(shadowCoord.xy + texel * vec2( 0.5,  0.5), shadowCoord.z, bias);
        return sum * 0.25;
    }

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            sum += compareShadow(shadowCoord.xy + texel * vec2(float(x), float(y)), shadowCoord.z, bias);
        }
    }
    return sum / 9.0;
}

vec3 screenSpaceReflection(vec3 viewPos, vec3 normal) {
    vec3 rayDir = reflect(normalize(viewPos), normalize(normal));
    vec3 reflected = vec3(0.0);
    float found = 0.0;
    float viewDistance = length(viewPos);

    // Fixed maximum iteration count; only water-mask pixels call this function.
    for (int i = 0; i < SSR_STEPS; i++) {
        float f = (float(i) + 1.0) / float(SSR_STEPS);
        float travel = f * (2.5 + min(viewDistance * 0.12, 8.0));
        vec3 rayPos = viewPos + rayDir * travel;
        vec4 clip = gbufferProjection * vec4(rayPos, 1.0);
        float safeW = max(abs(clip.w), 0.0001);
        vec2 sampleUv = clip.xy / safeW * 0.5 + 0.5;
        float inBounds = step(0.001, sampleUv.x) * step(sampleUv.x, 0.999) *
                         step(0.001, sampleUv.y) * step(sampleUv.y, 0.999) *
                         step(0.001, clip.w);
        vec2 safeUv = clamp(sampleUv, vec2(0.001), vec2(0.999));
        float sceneDepth = texture(depthtex0, safeUv).r;
        vec3 scenePos = unprojectView(safeUv, sceneDepth);
        float thickness = 0.12 + travel * 0.018;
        float crossing = step(0.0, scenePos.z - rayPos.z);
        float nearEnough = 1.0 - step(thickness, abs(scenePos.z - rayPos.z));
        float validDepth = 1.0 - step(0.99999, sceneDepth);
        float hit = inBounds * crossing * nearEnough * validDepth * (1.0 - found);
        reflected += pow(max(texture(colortex0, safeUv).rgb, vec3(0.0)), vec3(2.2)) * hit;
        found = max(found, hit);
    }

    return reflected;
}

/* DRAWBUFFERS:0 */
void main() {
    vec4 color = texture(colortex0, texcoord);
    color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(2.2));

    float depth = texture(depthtex0, texcoord).r;
    vec4 normalSample = texture(colortex2, texcoord);
    vec2 lightCoordinates = texture(colortex1, texcoord).rg;
    float waterMask = clamp(texture(colortex3, texcoord).r, 0.0, 1.0);

    if (depth < 0.999999 && normalSample.a > 0.5) {
        vec3 viewPos = unprojectView(texcoord, depth);
        vec3 normal = normalize(normalSample.rgb * 2.0 - 1.0);
        vec3 lightDir = normalize(shadowLightPosition);
        vec3 playerPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz;

        if (ENABLE_SHADOWS && lightCoordinates.y > 0.01) {
            vec4 shadowClip = shadowProjection * shadowModelView * vec4(playerPos, 1.0);
            vec3 shadowCoord = shadowClip.xyz / max(abs(shadowClip.w), 0.0001);
            shadowCoord = shadowCoord * 0.5 + 0.5;
            float visibility = filteredShadow(shadowCoord, normal, lightDir);
            float skyInfluence = smoothstep(0.02, 0.75, lightCoordinates.y);
            float shadowAmount = mix(1.0, mix(0.66, 1.0, visibility), skyInfluence);
            color.rgb *= shadowAmount;

            // Green-dominant pixels get a small wrap-light contribution as a leaf/grass SSS approximation.
            float greenMaterial = smoothstep(0.025, 0.16, color.g - max(color.r, color.b));
            float wrap = clamp((dot(normal, lightDir) + 0.35) / 1.35, 0.0, 1.0);
            color.rgb += vec3(0.018, 0.052, 0.012) * greenMaterial * wrap * skyInfluence;
        }

        if (ENABLE_SSR && waterMask > 0.02) {
            vec3 viewPosForSSR = unprojectView(texcoord, depth);
            vec3 reflected = screenSpaceReflection(viewPosForSSR, normal);
            float fresnel = 0.12 + 0.42 * pow(1.0 - abs(dot(normal, normalize(viewPosForSSR))), 5.0);
            float reflectionWeight = clamp(fresnel * waterMask, 0.0, 0.42);
            color.rgb = mix(color.rgb, reflected, reflectionWeight);
        }
    }

    gl_FragData[0] = color;
}
