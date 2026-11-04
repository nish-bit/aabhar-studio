"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "motion/react";

export interface RevealProps extends HTMLMotionProps<"div"> {
  /** Seconds to wait before revealing, for gentle staggering. */
  delay?: number;
  /** Vertical travel in px. Ignored under reduced motion. */
  distance?: number;
}

/** Fades and lifts content in once as it scrolls into view. */
export function Reveal({ delay = 0, distance = 16, children, ...props }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
