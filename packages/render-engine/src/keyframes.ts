// Time-driven animation, the Remotion way: every value is a pure function of
// the current time, so preview, scrubbing and export draw the same frame.
// Re-implemented here (no dependency): goScreen stays MIT.

export type Extrapolate = "clamp" | "extend" | "identity";

export type InterpolateOptions = {
  easing?: (x: number) => number;
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
};

/**
 * Maps `input` from `inputRange` onto `outputRange`, piece by piece.
 * Same contract as Remotion's `interpolate`: ranges of equal length (2 or
 * more), input range strictly increasing, extrapolation clamped by default.
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length)
    throw new Error("interpolate: ranges need the same length, 2 or more");
  for (let i = 1; i < inputRange.length; i++)
    if (!(inputRange[i] > inputRange[i - 1]))
      throw new Error("interpolate: inputRange must be strictly increasing");
  const {
    easing = (x: number) => x,
    extrapolateLeft = "clamp",
    extrapolateRight = "clamp",
  } = options;
  const last = inputRange.length - 1;
  if (input < inputRange[0] && extrapolateLeft !== "extend")
    return extrapolateLeft === "identity" ? input : outputRange[0];
  if (input > inputRange[last] && extrapolateRight !== "extend")
    return extrapolateRight === "identity" ? input : outputRange[last];
  let i = 1;
  while (i < last && input > inputRange[i]) i++;
  const [a, b] = [inputRange[i - 1], inputRange[i]];
  const k = easing((input - a) / (b - a));
  return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * k;
}

export type SpringConfig = {
  mass: number;
  damping: number;
  stiffness: number;
  // Never go past the target (no bounce).
  overshootClamping: boolean;
};

// Remotion's defaults: a light, lively bounce.
export const SPRING_DEFAULT: SpringConfig = {
  mass: 1,
  damping: 10,
  stiffness: 100,
  overshootClamping: false,
};

/**
 * A damped spring from 0 to 1, `t` seconds after it starts (closed form, so
 * any frame can be drawn on its own, in any order).
 */
export function spring(t: number, config: Partial<SpringConfig> = {}): number {
  const { mass, damping, stiffness, overshootClamping } = {
    ...SPRING_DEFAULT,
    ...config,
  };
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x =
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    x = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }
  return overshootClamping ? Math.min(1, x) : x;
}

/** Seconds until the spring stays within `threshold` of its target. */
export function springSettle(
  config: Partial<SpringConfig> = {},
  threshold = 0.005,
): number {
  const step = 1 / 120;
  let settledSince: number | null = null;
  for (let t = 0; t < 10; t += step) {
    if (Math.abs(1 - spring(t, config)) <= threshold) {
      settledSince ??= t;
      if (t - settledSince >= 0.25) return settledSince;
    } else settledSince = null;
  }
  return 10;
}
