import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const deviceColorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  body: hexColor,
  edge: hexColor,
});

export const cutoutSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.enum(["dynamic-island", "notch", "punch-hole"]),
    width: z.number().positive(),
    height: z.number().positive(),
    offsetTop: z.number().nonnegative(),
  }),
]);

export const insetsSchema = z.object({
  top: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
  right: z.number().nonnegative(),
});

export const deviceDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  brand: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["phone", "tablet", "laptop", "desktop"]),
  platform: z.enum(["ios", "android", "macos", "windows", "generic"]),
  tier: z.enum(["standard", "premium"]),
  // false until dimensions are checked against the manufacturer's specs.
  verified: z.boolean(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    dpr: z.number().positive(),
  }),
  frame: z.object({
    bezel: z.number().nonnegative(),
    radius: z.number().nonnegative(),
    screenRadius: z.number().nonnegative(),
    colors: z.array(deviceColorSchema).min(1),
  }),
  safeArea: insetsSchema,
  cutout: cutoutSchema,
  statusBar: z.object({
    style: z.enum(["ios", "android", "none"]),
    height: z.number().nonnegative(),
  }),
  homeIndicator: z.boolean(),
  userAgent: z.string().min(1),
});

export const devicePackMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  builtin: z.boolean(),
});

export type DeviceColor = z.infer<typeof deviceColorSchema>;
export type DeviceCutout = z.infer<typeof cutoutSchema>;
export type Insets = z.infer<typeof insetsSchema>;
export type DeviceDefinition = z.infer<typeof deviceDefinitionSchema>;
export type DevicePackMetadata = z.infer<typeof devicePackMetadataSchema>;
