"use client";

import { useEffect, useRef, useCallback } from "react";
import { subscribe } from "@/lib/raf";

interface WorldShaderProps {
  isNight: boolean;
  energy: number; // 0 = idle, 1 = running
  ripple: number; // 0-1, event intensity pulse
  tension: number; // 0-1, dead agents ratio → fog/atmosphere
}

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision mediump float;

uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_night;
uniform float u_energy;
uniform float u_ripple;
uniform float u_tension;

out vec4 fragColor;

// ── Noise ──

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.866, 0.5, -0.5, 0.866);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// 2-octave fbm for cheap volumetric effects (fog, etc.)
float fbm2(vec2 p) {
  mat2 rot = mat2(0.866, 0.5, -0.5, 0.866);
  float v = 0.5 * noise(p);
  p = rot * p * 2.0 + vec2(1.7, 9.2);
  v += 0.25 * noise(p);
  return v;
}

// ── Lightning ──

float lightning(vec2 uv, float t, float seed) {
  // Jagged vertical bolt using noise displacement
  float x = uv.x * 3.0 + seed * 7.13;
  float boltX = noise(vec2(x * 0.5, t * 12.0)) * 0.15 - 0.075;
  boltX += noise(vec2(x * 2.0, t * 18.0)) * 0.06;
  float dist = abs(uv.x - 0.5 - boltX);
  float bolt = smoothstep(0.008, 0.0, dist) * smoothstep(0.1, 0.4, uv.y) * smoothstep(0.1, 0.6, 1.0 - uv.y);
  // Branch
  float branchX = boltX + noise(vec2(x * 3.0, t * 15.0 + 3.0)) * 0.1;
  float branchDist = abs(uv.x - 0.5 - branchX);
  bolt += smoothstep(0.006, 0.0, branchDist) * 0.4 * smoothstep(0.3, 0.5, uv.y) * smoothstep(0.15, 0.4, 1.0 - uv.y);
  return bolt;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 parallax = (u_mouse - 0.5) * 0.06;
  float speed = 0.012 + u_energy * 0.018;
  float t = u_time * speed;

  // ── Shockwave distortion ──
  // Ripple creates an expanding ring distortion from center
  float shockwave = 0.0;
  if (u_ripple > 0.01) {
    float ringRadius = (1.0 - u_ripple) * 0.8; // expands as ripple decays
    float ringWidth = 0.08 + u_ripple * 0.12;
    vec2 centered = uv - 0.5;
    float dist = length(centered);
    float ring = smoothstep(ringRadius - ringWidth, ringRadius, dist)
               * smoothstep(ringRadius + ringWidth, ringRadius, dist);
    // Distort UV outward from ring
    vec2 dir = normalize(centered + 0.001);
    uv += dir * ring * u_ripple * 0.025;
    shockwave = ring * u_ripple;
  }

  // ── Terrain layers ──
  float deep = fbm(uv * 2.5 + parallax * 0.3 + vec2(t * 0.4, t * 0.25));
  float mid  = fbm(uv * 5.0 + parallax * 0.8 + vec2(-t * 0.6, t * 0.35));
  float near = fbm(uv * 9.0 + parallax * 1.8 + vec2(t * 0.8, -t * 0.4));
  float terrain = deep * 0.55 + mid * 0.3 + near * 0.15;

  // ── Color palettes ──
  vec3 dayBase     = vec3(0.012, 0.008, 0.003);
  vec3 dayAccent   = vec3(0.75, 1.0, 0.016);
  vec3 nightBase   = vec3(0.005, 0.008, 0.018);
  vec3 nightAccent = vec3(0.055, 0.647, 0.914);

  vec3 base   = mix(dayBase, nightBase, u_night);
  vec3 accent = mix(dayAccent, nightAccent, u_night);

  vec3 color = base * (0.6 + terrain * 0.8);

  // ── Accent glow on terrain ridges ──
  float ridgeMask = smoothstep(0.52, 0.68, terrain);
  color += accent * ridgeMask * (0.015 + u_energy * 0.035);

  // ── Energy boost ──
  color *= (1.0 + u_energy * 0.3);

  // ── Weather: Fog (tension-driven) ──
  if (u_tension > 0.01) {
    float fogNoise = fbm2(uv * 3.0 + vec2(u_time * 0.008, u_time * 0.005));
    float fogDensity = u_tension * 0.55;
    float fogMask = smoothstep(0.3, 0.7, fogNoise);
    vec3 fogColor = mix(vec3(0.02, 0.015, 0.01), vec3(0.01, 0.015, 0.025), u_night);
    color = mix(color, fogColor, fogMask * fogDensity);
    // Fog dims the scene
    color *= (1.0 - u_tension * 0.2);
  }

  // ── Weather: Rain streaks (night) ──
  if (u_night > 0.3) {
    float rainIntensity = smoothstep(0.3, 0.8, u_night) * 0.3;
    // Fast vertical lines — hash-based for performance
    float rainX = floor(uv.x * 120.0);
    float rainSeed = hash(vec2(rainX, 0.0));
    float rainY = fract(uv.y * 2.0 + u_time * 0.3 * (0.8 + rainSeed * 0.4) + rainSeed * 10.0);
    float streak = smoothstep(0.0, 0.03, rainY) * smoothstep(0.12, 0.03, rainY);
    streak *= step(0.92, rainSeed); // only ~8% of columns have rain
    color += nightAccent * streak * rainIntensity * (0.5 + u_energy * 0.5);
  }

  // ── Weather: Aurora (peaceful, low tension, night) ──
  float auroraFade = smoothstep(0.15, 0.0, u_tension) * u_night * (0.4 + u_energy * 0.3);
  if (auroraFade > 0.01) {
    float auroraY = uv.y * 2.0 - 0.3;
    float wave1 = sin(uv.x * 6.0 + u_time * 0.04 + noise(vec2(uv.x * 2.0, u_time * 0.02)) * 3.0);
    float wave2 = sin(uv.x * 10.0 - u_time * 0.03 + 1.5);
    float aurMask = smoothstep(0.2, 0.0, abs(auroraY - wave1 * 0.15 - wave2 * 0.08));
    vec3 aurColor = mix(vec3(0.05, 0.6, 0.9), vec3(0.2, 0.9, 0.1), sin(uv.x * 4.0 + u_time * 0.02) * 0.5 + 0.5);
    color += aurColor * aurMask * auroraFade * 0.08;
  }

  // ── Weather: Lightning (world events — high ripple) ──
  if (u_ripple > 0.3) {
    float lightningIntensity = smoothstep(0.3, 0.8, u_ripple);
    float bolt1 = lightning(uv, u_time, 0.0);
    float bolt2 = lightning(uv * vec2(0.7, 1.0) + vec2(0.3, 0.0), u_time, 3.7) * 0.5;
    float totalBolt = (bolt1 + bolt2) * lightningIntensity;
    // Flash illumination
    vec3 flashColor = mix(dayAccent, nightAccent, u_night) * 0.8 + 0.2;
    color += flashColor * totalBolt * 0.6;
    // Ambient flash — brief sky illumination
    color += flashColor * lightningIntensity * 0.03;
  }

  // ── Shockwave ring glow ──
  if (shockwave > 0.01) {
    color += accent * shockwave * 0.15;
  }

  // ── Event ripple brightness ──
  color *= (1.0 + u_ripple * 0.3);

  // ── CRT Post-Processing ──

  // Barrel distortion
  vec2 crtUV = uv - 0.5;
  float barrel = dot(crtUV, crtUV) * 0.015;
  // Apply subtle curvature color shift
  color *= (1.0 - barrel * 2.0);

  // Chromatic aberration — increases during events
  float caStrength = 0.0008 + u_ripple * 0.003 + u_energy * 0.0004;
  vec2 caDir = normalize(crtUV + 0.001) * caStrength;
  // Single-octave noise approx — avoids 2 full fbm calls (40 hash ops) per pixel
  vec2 caBase = uv * 5.0 + parallax * 0.8 + vec2(-t * 0.6, t * 0.35);
  float caN = noise(caBase);
  float rShift = noise(caBase + caDir * 5.0) - caN;
  float bShift = noise(caBase - caDir * 5.0) - caN;
  color.r += rShift * 0.2 * (1.0 + u_ripple * 3.0);
  color.b += bShift * 0.15 * (1.0 + u_ripple * 2.0);

  // Scanlines — thinner and more subtle than CSS overlay
  float scanline = sin(gl_FragCoord.y * 3.14159) * 0.5 + 0.5;
  scanline = mix(1.0, scanline, 0.04 + u_energy * 0.02);
  color *= scanline;

  // Phosphor grid — subtle RGB subpixel pattern
  float px = mod(gl_FragCoord.x, 3.0);
  vec3 phosphor = vec3(
    smoothstep(0.0, 1.0, px),
    smoothstep(1.0, 2.0, px) + smoothstep(3.0, 2.0, px),
    smoothstep(2.0, 3.0, px)
  );
  color *= mix(vec3(1.0), phosphor, 0.03);

  // Vignette — darkened edges for depth (enhanced CRT)
  float vig = 1.0 - dot(crtUV, crtUV) * 2.5;
  vig = clamp(vig * vig, 0.0, 1.0);
  color *= mix(0.2, 1.0, vig);

  // CRT flicker — subtle brightness variation
  float flicker = 1.0 - noise(vec2(u_time * 8.0, 0.0)) * 0.02;
  color *= flicker;

  fragColor = vec4(max(color, 0.0), 1.0);
}`;

export default function WorldShader({ isNight, energy, ripple, tension }: WorldShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef([0.5, 0.5]);
  const propsRef = useRef({ isNight, energy, ripple, tension });
  propsRef.current = { isNight, energy, ripple, tension };

  const onMouseMove = useCallback((e: MouseEvent) => {
    mouseRef.current = [e.clientX / window.innerWidth, 1.0 - e.clientY / window.innerHeight];
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    function compile(type: number, src: string) {
      const s = gl!.createShader(type);
      if (!s) return null;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        gl!.deleteShader(s);
        return null;
      }
      return s;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res:     gl.getUniformLocation(prog, "u_res"),
      time:    gl.getUniformLocation(prog, "u_time"),
      mouse:   gl.getUniformLocation(prog, "u_mouse"),
      night:   gl.getUniformLocation(prog, "u_night"),
      energy:  gl.getUniformLocation(prog, "u_energy"),
      ripple:  gl.getUniformLocation(prog, "u_ripple"),
      tension: gl.getUniformLocation(prog, "u_tension"),
    };

    let w = 0, h = 0;
    const resize = () => {
      w = Math.floor(canvas.clientWidth * 0.5) || 1;
      h = Math.floor(canvas.clientHeight * 0.5) || 1;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);

    const t0 = performance.now();
    let sNight = propsRef.current.isNight ? 1 : 0;
    let sEnergy = propsRef.current.energy;
    let sRipple = propsRef.current.ripple;
    let sTension = propsRef.current.tension;
    const sMouse = [0.5, 0.5];
    let lastFrame = 0;

    const loop = (now: number) => {
      if (now - lastFrame < 33) return;
      lastFrame = now;

      const p = propsRef.current;
      sNight   += ((p.isNight ? 1 : 0) - sNight)  * 0.03;
      sEnergy  += (p.energy - sEnergy)              * 0.05;
      sRipple  += (p.ripple - sRipple)              * 0.08;
      sTension += (p.tension - sTension)            * 0.02; // slow fog transition
      sMouse[0] += (mouseRef.current[0] - sMouse[0]) * 0.04;
      sMouse[1] += (mouseRef.current[1] - sMouse[1]) * 0.04;

      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.time, (now - t0) / 1000);
      gl.uniform2f(u.mouse, sMouse[0], sMouse[1]);
      gl.uniform1f(u.night, sNight);
      gl.uniform1f(u.energy, sEnergy);
      gl.uniform1f(u.ripple, sRipple);
      gl.uniform1f(u.tension, sTension);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const unsub = subscribe(loop);

    return () => {
      unsub();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [onMouseMove]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 -z-20 pointer-events-none"
      aria-hidden="true"
    />
  );
}
