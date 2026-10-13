import { blockById } from "@goscreen/blocks";
import { specToEdit } from "@goscreen/motion";
import { type Asset, parseEditState } from "@goscreen/render-engine";
import { ipc } from "@/lib/ipc";
import { blockOverlay, renderBlock } from "@/modules/editor/blocks";
import { renderingsOf } from "./hooks";
import { motionIpc } from "./ipc";
import { loadSpec } from "./pipeline";

/**
 * Opens a reproduced video in the editor, as layers: its latest rendering is
 * the video the edit belongs to (`render-N.edit.json`, `render-N.assets/`),
 * the reference's plates and pictures are imported as the edit's assets, and
 * each counter becomes a counter block. Everything can then be changed,
 * reused in another video, or extended. Returns the video to open.
 */
export async function openInEditor(id: string): Promise<string> {
  const ref = (await motionIpc.references()).find((r) => r.id === id);
  if (!ref) throw new Error(`No reference ${id}.`);
  const render = renderingsOf(ref.files)[0];
  if (!render) throw new Error("Render the spec first: the edit belongs to a rendering.");
  const host = await motionIpc.filePath(id, render);
  const spec = await loadSpec(id);

  // Each plate and picture of the spec, copied into the edit.
  const files = new Set<string>();
  for (const shot of spec.shots) {
    if (shot.plate) files.add(shot.plate);
    for (const v of shot.visuals) files.add(v.src);
  }
  const assets = new Map<string, Asset>();
  for (const file of files) {
    const imported = await ipc.assetImport(host, await motionIpc.filePath(id, file));
    assets.set(file, {
      id: imported.id,
      name: file.replace(/^reference\./, ""),
      kind: imported.kind === "video" ? "video" : "image",
      file: imported.file,
      duration: null,
    });
  }

  const { edit, counters } = specToEdit(spec, assets);
  // Counters as counter blocks: their number and colour stay settings.
  const block = blockById("stat-counter");
  if (block)
    for (const c of counters) {
      const props = { value: c.value, prefix: "", suffix: "", label: "", ink: c.color, accent: c.color };
      const rendered = await renderBlock(host, edit, block, props, c.box, c.duration);
      edit.assets.push(rendered.asset);
      edit.overlays.push(blockOverlay(block, props, rendered.asset.id, c.start, c.duration, c.box, 20));
    }
  const valid = parseEditState(JSON.parse(JSON.stringify(edit)));
  if (!valid) throw new Error("The edit could not be built.");
  await ipc.editSave(host, valid);
  return host;
}
