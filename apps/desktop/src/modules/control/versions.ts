import {
  describeDiff,
  diffEdits,
  type EditState,
  isEmptyDiff,
} from "@goscreen/render-engine";
import { z } from "zod";
import {
  currentEditOf,
  listVersions,
  readVersion,
  recordVersion,
  restoreVersion,
} from "@/modules/editor/versions";
import { defineCommand } from "./registry";

// The montage's versions for an AI: list them, read what changed between
// two of them (or since the last one), go back to one, or sign one with a
// message. Same journal as the editor's History panel.

const video = z
  .string()
  .min(1)
  .describe("Absolute path of a video (projects.videos)");

const versionId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .describe("A version id (edit.versions)");

/** A version's state, or the montage as it is now for "current". */
async function stateOf(
  videoPath: string,
  ref: string,
): Promise<{ label: string; state: EditState }> {
  if (ref === "current") {
    const state = await currentEditOf(videoPath);
    if (!state) throw new Error("This video has no montage yet.");
    return { label: "current", state };
  }
  const v = await readVersion(videoPath, ref);
  return {
    label: `${v.id} (${v.command ?? "autosave"}, ${v.at})`,
    state: v.state,
  };
}

export function registerVersionCommands() {
  defineCommand({
    name: "edit.versions",
    title: "List a montage's versions",
    description:
      "Every saved version of the montage, oldest first: id, date, author (person or ai), the command that wrote it (none = autosave) and its message.",
    input: z.object({ video }),
    run: async (i) => {
      const versions = await listVersions(i.video);
      return { versions, count: versions.length };
    },
  });

  defineCommand({
    name: "edit.diff",
    title: "Compare two versions",
    description:
      'What changed between two versions of the montage, by id (clips, overlays, zooms, sounds, layers and settings). Defaults: `from` = the latest version, `to` = the montage as it is now. Use "current" for the live montage.',
    input: z.object({
      video,
      from: z.union([versionId, z.literal("current")]).optional(),
      to: z.union([versionId, z.literal("current")]).optional(),
    }),
    run: async (i) => {
      let from = i.from;
      if (!from) {
        const all = await listVersions(i.video);
        const last = all[all.length - 1];
        if (!last) throw new Error("This montage has no version yet.");
        from = last.id;
      }
      const a = await stateOf(i.video, from);
      const b = await stateOf(i.video, i.to ?? "current");
      const diff = diffEdits(a.state, b.state);
      return {
        from: a.label,
        to: b.label,
        changed: !isEmptyDiff(diff),
        summary: describeDiff(diff),
        diff,
      };
    },
  });

  defineCommand({
    name: "edit.restore",
    title: "Restore a version",
    description:
      'Loads a version as the montage (an undoable change when the video is open) and writes a "restore" version. The state before is kept as a version too.',
    input: z.object({ video, version: versionId }),
    run: async (i) => {
      const before = await currentEditOf(i.video);
      const restored = await restoreVersion(i.video, i.version);
      const target = await readVersion(i.video, i.version);
      return {
        restored,
        summary: before
          ? describeDiff(diffEdits(before, target.state))
          : "No montage before.",
      };
    },
  });

  defineCommand({
    name: "edit.saveVersion",
    title: "Save a version",
    description:
      "Writes the montage as it is now as a named version, like a commit message. Explicit versions are never pruned.",
    input: z.object({
      video,
      message: z.string().min(1).max(200).describe("Why this version matters"),
    }),
    run: async (i) => {
      const state = await currentEditOf(i.video);
      if (!state) throw new Error("This video has no montage yet.");
      return recordVersion(i.video, {
        author: "ai",
        command: "edit.saveVersion",
        message: i.message,
        state,
      });
    },
  });
}
