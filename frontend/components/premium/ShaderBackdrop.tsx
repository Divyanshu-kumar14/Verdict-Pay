"use client";

/**
 * WebGL backdrop (Silk-class shader, React Bits pattern) built on ogl.
 *
 * Used behind the hero only. It is a living gradient with real depth, so the
 * first screen does not read as a flat dark rectangle.
 *
 * Performance contract: one full-screen triangle, no per-frame allocations,
 * device pixel ratio capped at 1.5, rendering parked while the tab is hidden or
 * the element is off-screen, and fully disabled under prefers-reduced-motion.
 */

import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";

const VERT = `attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/* Domain-warped fbm: two noise fields, one displacing the other. That is what
 * gives silk its liquid folding instead of plain cloud. */
const FRAG = `precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uIntensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 q = vec2(fbm(uv * 2.4 + uTime * 0.045), fbm(uv * 2.4 + vec2(5.2, 1.3) - uTime * 0.035));
  vec2 r = vec2(
    fbm(uv * 3.1 + 3.4 * q + vec2(1.7, 9.2) + uTime * 0.02),
    fbm(uv * 3.1 + 3.4 * q + vec2(8.3, 2.8) - uTime * 0.025)
  );
  float f = fbm(uv * 2.2 + 3.2 * r);

  float folds = smoothstep(0.18, 0.92, f);
  vec3 col = mix(uColorA, uColorB, folds);
  col = mix(col, uColorC, smoothstep(0.55, 1.0, length(r)) * 0.65);

  /* Vignette keeps the centre readable for overlaid type. */
  float d = distance(uv, vec2(0.5));
  col *= 1.0 - smoothstep(0.32, 0.95, d) * 0.72;

  gl_FragColor = vec4(col * uIntensity, 1.0);
}`;

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

function toRgb(hex: string): [number, number, number] {
  const match = HEX.exec(hex);
  const r = match?.[1];
  const g = match?.[2];
  const b = match?.[3];
  if (r === undefined || g === undefined || b === undefined) return [0, 0, 0];
  return [
    Number.parseInt(r, 16) / 255,
    Number.parseInt(g, 16) / 255,
    Number.parseInt(b, 16) / 255,
  ];
}

export type ShaderBackdropProps = {
  /** Base tone of the field. */
  colorA?: string;
  /** Folded highlight tone. */
  colorB?: string;
  /** Accent that bleeds through the deepest folds. */
  colorC?: string;
  /** Overall exposure; keep below 1 so overlaid text stays legible. */
  intensity?: number;
  className?: string;
};

export function ShaderBackdrop({
  colorA = "#05070a",
  colorB = "#0d2033",
  colorC = "#0e5f4a",
  intensity = 1,
  className,
}: ShaderBackdropProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 1.5), alpha: false });
    } catch {
      // No WebGL (headless, blocked GPU): the CSS gradient behind stays visible.
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0.02, 0.03, 0.04, 1);
    host.appendChild(gl.canvas);
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    gl.canvas.style.display = "block";

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: toRgb(colorA) },
        uColorB: { value: toRgb(colorB) },
        uColorC: { value: toRgb(colorC) },
        uIntensity: { value: intensity },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    const resize = (): void => {
      renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let frame = 0;
    let visible = true;
    const onVisibility = (): void => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);

    const clock = { t: 0 };
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
      if (!visible) return;
      clock.t += 1 / 60;
      program.uniforms.uTime.value = clock.t;
      renderer.render({ scene: mesh });
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      if (gl.canvas.parentNode === host) host.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [colorA, colorB, colorC, intensity]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={className ?? "absolute inset-0"}
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, ${colorB} 0%, ${colorA} 55%, #04060a 100%)`,
      }}
    />
  );
}
