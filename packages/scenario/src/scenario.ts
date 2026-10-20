import { z } from "zod";

// A scenario is a scripted take: a browser (Playwright) plays the steps on a
// real site, while each `scene` names what is on screen. The montage is then
// derived from the take (edit.ts), so the video is data, not hand editing.

const regex = z.string().refine(
  (s) => {
    try {
      new RegExp(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: "not a valid regular expression" },
);

/** What to act on. One way to find it, plus optional refinements. */
export const targetSchema = z
  .object({
    css: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    // CSS of an iframe to look inside (payment widgets, embeds).
    frame: z.string().min(1).optional(),
    // Keeps only matches that contain this text (case-insensitive).
    hasText: z.string().min(1).optional(),
    exact: z.boolean().optional(),
    // Which match: 0 = first (default), -1 = last.
    nth: z.number().int().min(-1).optional(),
  })
  .strict()
  .refine(
    (t) =>
      [t.css, t.text, t.role, t.label, t.placeholder, t.testId].filter(
        (v) => v !== undefined,
      ).length === 1,
    {
      message:
        "give exactly one of css, text, role, label, placeholder, testId",
    },
  )
  .refine((t) => t.name === undefined || t.role !== undefined, {
    message: "name only refines a role",
  });

export type Target = z.infer<typeof targetSchema>;

// Only web pages: a scenario from someone else must not read local files
// (file:, chrome:, data:) into the take or a remembered value.
const webUrl = z
  .string()
  .regex(/^https?:\/\//i, { message: "only http:// or https:// addresses" });

const ms = z.number().int().min(0).max(120_000);

export const stepSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("goto"), url: webUrl }).strict(),
  // Starts a scene: everything until the next scene or cut is one clip.
  z.object({ do: z.literal("scene"), caption: z.string().min(1) }).strict(),
  // Ends the scene: what follows (logins, loading) stays out of the montage.
  z.object({ do: z.literal("cut") }).strict(),
  z
    .object({
      do: z.literal("tap"),
      target: targetSchema,
      // Taps again, a beat apart (a + button pressed 9 times).
      repeat: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal("type"),
      // Without a target, keys go to the focused field (code inputs).
      target: targetSchema.optional(),
      text: z.string(),
      delay: ms.optional(),
      // Empties the field first.
      clear: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal("check"),
      target: targetSchema,
      value: z.boolean().default(true),
    })
    .strict(),
  z.object({ do: z.literal("press"), key: z.string().min(1) }).strict(),
  z
    .object({
      do: z.literal("scroll"),
      by: z.number().optional(),
      to: targetSchema.optional(),
      duration: ms.optional(),
    })
    .strict()
    .refine((s) => (s.by === undefined) !== (s.to === undefined), {
      message: "scroll needs either by or to",
    }),
  z.object({ do: z.literal("wait"), ms }).strict(),
  z
    .object({
      do: z.literal("waitFor"),
      target: targetSchema,
      timeout: ms.optional(),
    })
    .strict(),
  z
    .object({ do: z.literal("waitUrl"), match: regex, timeout: ms.optional() })
    .strict(),
  // Keeps a value for later steps as {{name}}: from an element's text or,
  // without a target, from the page URL; `match` keeps its first group.
  z
    .object({
      do: z.literal("remember"),
      name: z.string().regex(/^\w+$/),
      target: targetSchema.optional(),
      match: regex.optional(),
    })
    .strict(),
  // Another browser session (its own cookies): a second account.
  z
    .object({ do: z.literal("session"), name: z.string().regex(/^[\w-]+$/) })
    .strict(),
]);

export type Step = z.infer<typeof stepSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const cardSchema = z
  .object({
    // *Words between stars* are drawn in the accent colour.
    title: z.string().min(1),
    subtitle: z.string().default(""),
    eyebrow: z.string().optional(),
    duration: z.number().min(0.5).max(15).default(3),
  })
  .strict();

/** The montage built from the take: Remotion-style "composition props". */
export const filmSchema = z
  .object({
    aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
    background: hex.default("#f4f1ea"),
    ink: hex.default("#16241c"),
    accent: hex.default("#e9a100"),
    font: z.string().min(1).default("Inter"),
    captions: z.enum(["top", "bottom", "none"]).default("top"),
    // Zoom on bursts of taps; 1 = no zoom.
    zoom: z.number().min(1).max(3).default(1.35),
    // "showcase": the VSL look (chapter kicker and title above a framed
    // device, accent disc behind it, brand cards); "plain": centered.
    look: z.enum(["showcase", "plain"]).default("showcase"),
    // The scenes' background: flat colour, or one of the course's moving
    // cinematic backdrops built from the accent colour.
    backdrop: z.enum(["flat", "circles", "blob", "waves"]).default("flat"),
    // "framed": the device hardware around the screen; "premium": the SaaS
    // enhanced screen recording (frameless glass, outline, lean, pan-in).
    screen: z.enum(["framed", "premium"]).default("framed"),
    // Chapter kicker: "BUYER · 2/11". Empty: no kicker.
    label: z.string().default(""),
    // On the cards, with the accent dot.
    brand: z.string().default(""),
    intro: cardSchema.optional(),
    outro: cardSchema.optional(),
    // The library entry whose direction the film follows (its slug), so the
    // creator stays credited and the AI can read the same brief again.
    inspiration: z.string().regex(/^[\w-]+$/).optional(),
  })
  .strict();

export type Film = z.infer<typeof filmSchema>;

export const scenarioSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    url: webUrl.pipe(z.string().url()),
    device: z
      .object({ id: z.string().min(1), color: z.string().optional() })
      .strict()
      .default({ id: "galaxy-s25" }),
    locale: z.string().default("en-US"),
    timezone: z.string().optional(),
    colorScheme: z.enum(["light", "dark"]).default("light"),
    // Values asked before the run ({{name}} in texts and URLs).
    vars: z
      .record(
        z.string().regex(/^\w+$/),
        z
          .object({
            label: z.string().optional(),
            default: z.string().optional(),
            // Never remembered between runs.
            secret: z.boolean().optional(),
          })
          .strict(),
      )
      .default({}),
    // Text blocks hidden before they are painted (test banners, codes). The
    // digits they hold can be typed later as {{code}}.
    mask: z.array(regex).default([]),
    film: filmSchema.default(filmSchema.parse({})),
    steps: z.array(stepSchema).min(1),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;

export type ParsedScenario =
  | { ok: true; scenario: Scenario }
  | { ok: false; errors: string[] };

/** Reads a scenario from JSON text; errors name the exact place. */
export function parseScenario(text: string): ParsedScenario {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  const parsed = scenarioSchema.safeParse(json);
  if (parsed.success) return { ok: true, scenario: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    ),
  };
}

/** Placeholders filled at run time by the runner, not by the user. */
export const RUNTIME_VARS = ["code"] as const;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Names set while the scenario plays (`remember`). */
export function rememberedVars(scenario: Scenario): string[] {
  return scenario.steps.flatMap((s) => (s.do === "remember" ? [s.name] : []));
}

const TARGET_TEXTS = [
  "css",
  "text",
  "name",
  "label",
  "placeholder",
  "testId",
  "frame",
  "hasText",
] as const;

function mapTarget(t: Target, f: (s: string) => string): Target {
  const out: Target = { ...t };
  for (const key of TARGET_TEXTS) {
    const v = out[key];
    if (v !== undefined) out[key] = f(v);
  }
  return out;
}

/** The step with `f` applied to every text that may hold a {{value}}. */
export function mapStepTexts(step: Step, f: (s: string) => string): Step {
  switch (step.do) {
    case "goto":
      return { ...step, url: f(step.url) };
    case "type":
      return {
        ...step,
        text: f(step.text),
        ...(step.target ? { target: mapTarget(step.target, f) } : {}),
      };
    case "tap":
    case "check":
    case "waitFor":
      return { ...step, target: mapTarget(step.target, f) };
    case "scroll":
      return step.to ? { ...step, to: mapTarget(step.to, f) } : step;
    case "remember":
      return step.target
        ? { ...step, target: mapTarget(step.target, f) }
        : step;
    default:
      return step;
  }
}

/** Variables a scenario uses that the user must fill. */
export function requiredVars(scenario: Scenario): string[] {
  const used = new Set<string>(Object.keys(scenario.vars));
  const scan = (s: string) => {
    for (const m of s.matchAll(PLACEHOLDER)) used.add(m[1]);
    return s;
  };
  scan(scenario.url);
  for (const step of scenario.steps) mapStepTexts(step, scan);
  for (const v of RUNTIME_VARS) used.delete(v);
  for (const v of rememberedVars(scenario)) used.delete(v);
  return [...used];
}

export type Resolved =
  | { ok: true; scenario: Scenario }
  | { ok: false; missing: string[] };

/**
 * Fills {{name}} with the user's values (runtime ones such as {{code}} stay
 * for the runner). A missing value is an error, never an empty string.
 */
export function resolveVars(
  scenario: Scenario,
  values: Record<string, string>,
): Resolved {
  const value = (name: string) =>
    values[name] !== undefined && values[name] !== ""
      ? values[name]
      : scenario.vars[name]?.default;
  const missing = requiredVars(scenario).filter((n) => value(n) === undefined);
  if (missing.length > 0) return { ok: false, missing };
  const runtime = new Set<string>([
    ...RUNTIME_VARS,
    ...rememberedVars(scenario),
  ]);
  const fill = (s: string) =>
    s.replace(PLACEHOLDER, (all, name: string) =>
      runtime.has(name) ? all : (value(name) ?? all),
    );
  return {
    ok: true,
    scenario: {
      ...scenario,
      url: fill(scenario.url),
      steps: scenario.steps.map((step) => mapStepTexts(step, fill)),
    },
  };
}

function describeTarget(t: Target): string {
  const base =
    t.css ??
    (t.text !== undefined
      ? `"${t.text}"`
      : t.role !== undefined
        ? `${t.role}${t.name ? ` "${t.name}"` : ""}`
        : t.label !== undefined
          ? `field "${t.label}"`
          : t.placeholder !== undefined
            ? `field "${t.placeholder}"`
            : `[${t.testId}]`);
  const filtered = t.hasText ? `${base} with "${t.hasText}"` : base;
  return t.frame ? `${filtered} in ${t.frame}` : filtered;
}

/** One line per step, for progress and the step list. */
export function stepLabel(step: Step): string {
  switch (step.do) {
    case "goto":
      return `Open ${step.url}`;
    case "scene":
      return `Scene: ${step.caption}`;
    case "cut":
      return "Cut";
    case "tap":
      return `Tap ${describeTarget(step.target)}${step.repeat ? ` x${step.repeat}` : ""}`;
    case "type":
      return step.target
        ? `Type into ${describeTarget(step.target)}`
        : "Type on the keyboard";
    case "check":
      return `${step.value ? "Check" : "Uncheck"} ${describeTarget(step.target)}`;
    case "remember":
      return `Remember {{${step.name}}} from ${step.target ? describeTarget(step.target) : "the URL"}`;
    case "press":
      return `Press ${step.key}`;
    case "scroll":
      return step.to ? `Scroll to ${describeTarget(step.to)}` : "Scroll";
    case "wait":
      return `Wait ${step.ms} ms`;
    case "waitFor":
      return `Wait for ${describeTarget(step.target)}`;
    case "waitUrl":
      return `Wait for URL ${step.match}`;
    case "session":
      return `Session ${step.name}`;
  }
}
