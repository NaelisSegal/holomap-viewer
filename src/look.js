// The two looks. Lines are plain lines: no glow, no bloom.
import * as THREE from 'three';

const vertexShader = /* glsl */`
varying vec3 vW;
varying vec3 vN;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = /* glsl */`
uniform vec3 uColor;
uniform float uWashed;    // 0 wireframe, 1 washed
uniform float uSelected;
uniform float uInside;    // the camera is in this room
uniform float uDim;       // fades rooms that are not in focus
uniform float uClipY;
uniform float uStep;      // grid line spacing in metres
uniform vec3 uCam;
uniform float uFogDist;
uniform vec3 uFogColor;
varying vec3 vW;
varying vec3 vN;
#include <logdepthbuf_pars_fragment>

float gridLine(float c) {
  float w = fwidth(c);
  float d = abs(fract(c - 0.5) - 0.5);
  return 1.0 - smoothstep(0.0, 1.4 * w, d);
}

void main() {
  #include <logdepthbuf_fragment>
  if (vW.y > uClipY) discard;

  vec3 n = normalize(vN);            // points out of the room
  float floorK = smoothstep(-0.55, -0.8, n.y);
  float ceilK = smoothstep(0.55, 0.8, n.y);
  float wallK = 1.0 - floorK - ceilK;

  float s = uStep;
  float minor = wallK * gridLine(vW.y / s)
    + floorK * max(gridLine(vW.x / s), gridLine(vW.z / s));
  float major = wallK * gridLine(vW.y / (5.0 * s))
    + floorK * max(gridLine(vW.x / (5.0 * s)), gridLine(vW.z / (5.0 * s)));
  float line = max(minor * 0.5, major);

  vec3 lineCol = mix(uColor, vec3(1.0), 0.3);
  if (uSelected > 0.5) lineCol = vec3(1.0, 0.70, 0.28);

  vec3 fillCol;
  float fillA, lineA;
  if (uWashed < 0.5) {
    fillCol = uColor * 0.55;
    fillA = 0.07 + 0.10 * floorK + uInside * (0.10 * floorK + 0.04);
    lineA = line * (0.85 + 0.15 * uInside);
  } else {
    vec3 L = normalize(vec3(0.35, 1.0, 0.25));
    float light = 0.55 + 0.45 * abs(dot(n, L));
    fillCol = mix(uColor, vec3(1.0), 0.35) * light;
    fillA = 0.26 + 0.12 * floorK + uInside * 0.22;
    lineA = line * 0.22;
  }
  if (uSelected > 0.5) fillA += 0.05;

  float a = lineA + fillA * (1.0 - lineA);
  vec3 col = mix(fillCol, lineCol, lineA / max(a, 1e-4));

  float fog = clamp(length(vW - uCam) / uFogDist, 0.0, 1.0);
  col = mix(col, uFogColor, fog * (uWashed > 0.5 ? 0.75 : 0.55));
  a *= (1.0 - 0.55 * fog) * uDim;
  gl_FragColor = vec4(col, a);
}`;

export function roomMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uWashed: { value: 0 },
      uSelected: { value: 0 },
      uInside: { value: 0 },
      uDim: { value: 1 },
      uClipY: { value: 1e9 },
      uStep: { value: 1 },
      uCam: { value: new THREE.Vector3() },
      uFogDist: { value: 1000 },
      uFogColor: { value: new THREE.Color('#04060c') },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
}

// automatic colours: greens, teals, blues, violets
export function autoColor(i) {
  const h = 0.38 + 0.42 * ((i * 0.618034) % 1);
  return new THREE.Color().setHSL(h, 0.75, 0.55);
}
