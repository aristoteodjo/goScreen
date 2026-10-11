import { z } from "zod";
import { create } from "zustand";

// Every action an AI may take is a typed command: a name, what it does (for
// the model) and the shape of its input, checked before it runs. The same
// catalogue is served to the MCP server and the CLI, so they never drift.

export type Command<I extends z.ZodType = z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: I;
  // Moves something to the trash, spends a real run on a site...
  destructive?: boolean;
  run: (input: z.output<I>) => Promise<unknown>;
};

const commands = new Map<string, Command>();

export function defineCommand<I extends z.ZodType>(command: Command<I>) {
  if (!/^[a-z]+(\.[a-zA-Z]+)+$/.test(command.name))
    throw new Error(`Bad command name ${command.name}`);
  commands.set(command.name, command as unknown as Command);
}

export function catalog() {
  return [...commands.values()].map((c) => ({
    name: c.name,
    title: c.title,
    description: c.description,
    destructive: c.destructive ?? false,
    inputSchema: z.toJSONSchema(c.input, {
      io: "input",
      unrepresentable: "any",
    }),
  }));
}

export type Answer =
  | { ok: true; result: unknown }
  | { ok: false; error: string; issues?: string[] };

/** Runs a command by name: validated input, errors as plain sentences. */
export async function runCommand(name: string, raw: unknown): Promise<Answer> {
  const command = commands.get(name);
  if (!command)
    return {
      ok: false,
      error: `Unknown command "${name}". Call control.catalog for the list.`,
    };
  const input = command.input.safeParse(raw ?? {});
  if (!input.success)
    return {
      ok: false,
      error: `Invalid input for ${name}.`,
      issues: input.error.issues.map(
        (i) => `${i.path.join(".") || "(input)"}: ${i.message}`,
      ),
    };
  try {
    return { ok: true, result: (await command.run(input.data)) ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// What the AI did, for the human watching the studio.
export type ActivityEntry = {
  id: string;
  at: number;
  command: string;
  title: string;
  ok: boolean | null;
  error: string | null;
};

type ActivityState = {
  entries: ActivityEntry[];
  panelOpen: boolean;
  push: (e: ActivityEntry) => void;
  settle: (id: string, ok: boolean, error: string | null) => void;
  setPanelOpen: (open: boolean) => void;
};

export const useActivity = create<ActivityState>((set) => ({
  entries: [],
  panelOpen: false,
  push: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, 200) })),
  settle: (id, ok, error) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ok, error } : e)),
    })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));

export const titleOf = (name: string) => commands.get(name)?.title ?? name;
