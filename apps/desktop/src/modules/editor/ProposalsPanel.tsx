import {
  buildEdit,
  buildProposals,
  type Campaign,
  CHANNELS,
  type Channel,
  defaultCampaign,
  OBJECTIVES,
  type Objective,
  type Proposal,
  type Site,
} from "@goscreen/campaign";
import { outputSize, stageArea } from "@goscreen/render-engine";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ipc } from "@/lib/ipc";
import { useProject } from "@/modules/studio/store/project";
import { initialLayers } from "./devices";
import { Section } from "./PanelKit";
import { player, useSession } from "./session";
import { useEdit, usePlayback } from "./store";

/** Reads the brand once and the sections of every toured page (the home page otherwise). */
async function readSite(url: string, pages: string[]): Promise<Site> {
  const brand = await ipc.siteBrand(url);
  const sections = [];
  for (const page of pages.length > 0 ? pages : [url]) {
    const found = await ipc.siteSections(page).catch(() => []);
    sections.push(...found.map((s) => ({ ...s, page })));
  }
  return { url, brand, sections };
}

/** Builds the montage of a proposal on the opened recording and applies it (undoable). */
function apply(proposal: Proposal, site: Site, campaign: Campaign) {
  const { chapters, layers, source, cameraUrl } = useSession.getState();
  const duration = usePlayback.getState().duration;
  const edit = buildEdit(proposal, { site, campaign, duration, chapters });
  const placed =
    layers.length > 0 && source
      ? initialLayers(
          layers,
          stageArea(
            outputSize(edit.aspect, source),
            edit.camera,
            cameraUrl !== null,
          ),
        )
      : null;
  useEdit.getState().change(() => ({ ...edit, layers: placed }));
  player.seek(0);
}

export function ProposalsPanel() {
  const chapters = useSession((s) => s.chapters);
  const projectUrl = useProject((s) => s.url);
  const [url, setUrl] = useState(chapters[0]?.url ?? projectUrl ?? "");
  const [site, setSite] = useState<Site | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  const read = useMutation({
    mutationFn: () => readSite(url, [...new Set(chapters.map((c) => c.url))]),
    onSuccess: (data) => {
      if (!data?.brand || !Array.isArray(data.sections)) return;
      setSite(data);
      setCampaign(defaultCampaign(data));
    },
    onError: (e) =>
      toast.error("Could not read the site", { description: String(e) }),
  });

  const proposals = useMemo(
    () => (site && campaign ? buildProposals({ site, campaign }) : []),
    [site, campaign],
  );
  const patch = (p: Partial<Campaign>) =>
    setCampaign((c) => (c ? { ...c, ...p } : c));

  return (
    <>
      <Section
        title="Site"
        hint="Brand, pages and sections are read from the site; nothing is site-specific."
      >
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
          <Button
            size="sm"
            disabled={!url || read.isPending}
            onClick={() => read.mutate()}
          >
            {read.isPending ? "Reading…" : "Read"}
          </Button>
        </div>
        {site ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="size-3 rounded-full border"
              style={{ background: site.brand.colors.primary ?? "transparent" }}
            />
            <span className="font-medium text-foreground">
              {site.brand.name}
            </span>
            <span>
              {site.sections.length} sections · {chapters.length || 1} page(s)
            </span>
          </div>
        ) : null}
      </Section>

      {campaign ? (
        <Section title="Brief">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            className="flex-wrap"
            value={campaign.objective}
            onValueChange={(v) => v && patch({ objective: v as Objective })}
          >
            {OBJECTIVES.map((o) => (
              <ToggleGroupItem key={o} value={o} className="text-xs">
                {o}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="multiple"
            size="sm"
            variant="outline"
            className="flex-wrap"
            value={campaign.channels}
            onValueChange={(v) =>
              v.length > 0 && patch({ channels: v as Channel[] })
            }
          >
            {CHANNELS.map((c) => (
              <ToggleGroupItem key={c} value={c} className="text-xs">
                {c}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Input
            value={campaign.offer}
            onChange={(e) => patch({ offer: e.target.value })}
            placeholder="Offer / hook"
          />
          <Input
            value={campaign.cta.label}
            onChange={(e) =>
              patch({ cta: { ...campaign.cta, label: e.target.value } })
            }
            placeholder="Call to action"
          />
        </Section>
      ) : null}

      {site && campaign ? (
        <Section
          title="Proposals"
          hint="Applying replaces the montage; undo brings the previous one back."
        >
          <div className="grid grid-cols-2 gap-2">
            {proposals.map((p) => (
              <button
                key={`${p.recipe.id}-${p.format}-${p.variant}`}
                type="button"
                onClick={() => apply(p, site, campaign)}
                className="flex flex-col items-start gap-0.5 rounded-lg border bg-white/[0.03] p-2.5 text-left transition-colors hover:border-violet-400/60"
              >
                <span className="text-[13px] font-medium">
                  {p.recipe.label}
                  {p.variant > 0 ? ` #${p.variant + 1}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.format} · {p.recipe.duration[0]}–{p.recipe.duration[1]} s
                </span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
