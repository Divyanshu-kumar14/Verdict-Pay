"use client";

/**
 * The control room's shared motion language.
 *
 * One spring (stiffness 260 / damping 24 / mass 0.8) for responsive, controlled
 * physics — drawers, indicators, panels, selections. A snapped 180–280ms
 * ease-out for page and content entrances. Everything is behind Motion's
 * built-in reduced-motion handling, so nothing moves for a reader who asked
 * for stillness.
 */

import type { Transition, Variants } from "motion/react";

/** Primary spring: responsive and controlled, never bouncy. */
export const SPRING: Transition = { type: "spring", stiffness: 260, damping: 24, mass: 0.8 };

/** Softer spring for larger compositing surfaces (drawers, detail panels). */
export const SPRING_SOFT: Transition = { type: "spring", stiffness: 180, damping: 22, mass: 0.9 };

/** Cubic ease-out shared by chart draw-ins and bar growth. */
export const EASE_OUT: [number, number, number, number] = [0.2, 0, 0, 1];

/** Page and section entrance: a small rise with a 220ms ease-out. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } },
};

/** Parent that staggers its fadeUp children a beat apart. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } },
};

/** Child item packaged with fadeUp so a list can stagger without repeating. */
export const staggerItem: Variants = fadeUp;
