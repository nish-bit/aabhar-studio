"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";

/**
 * Respects the OS "reduce motion" setting for every Motion animation:
 * transform and layout animations are disabled, opacity fades remain.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
