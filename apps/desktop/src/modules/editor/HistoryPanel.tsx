import {
  describeDiff,
  diffEdits,
  type EditVersionMeta,
  isEmptyDiff,
} from "@goscreen/render-engine";
import {
  Copy01Icon,
  FloppyDiskIcon,
  RobotIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { openPlace } from "@/modules/tabs/tabs";
import { Section } from "./PanelKit";
import { useSession } from "./session";
import { useEdit } from "./store";
import {
  duplicateMontage,
  readVersion,
  recordVersion,
  restoreVersion,
  useVersions,
  useVersionsUi,
} from "./versions";

// The montage's versions, the git way: who, what command, which message,
// when; the selected one shows what differs from the montage on screen.

const titleOf = (v: EditVersionMeta) =>
  v.message ?? (v.command ? v.command : "Autosave");

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function HistoryPanel() {
  const videoPath = useSession((s) => s.videoPath);
  const edit = useEdit((s) => s.edit);
  const setPrompt = useVersionsUi((s) => s.setPrompt);
  const versions = useVersions(videoPath || null);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useMemo(
    () => [...(versions.data ?? [])].reverse(),
    [versions.data],
  );
  const current = list.find((v) => v.id === selected) ?? null;

  const preview = useQuery({
    queryKey: ["edit-version", videoPath, selected],
    queryFn: () => readVersion(videoPath, selected ?? ""),
    enabled: selected !== null,
  });
  const diff = useMemo(
    () => (preview.data ? diffEdits(preview.data.state, edit) : null),
    [preview.data, edit],
  );

  const restore = useMutation({
    mutationFn: (id: string) => restoreVersion(videoPath, id),
    onSuccess: (meta) => {
      if (typeof meta?.id !== "string") return;
      toast.success("Version restored", { description: "⌘Z undoes it." });
    },
    onError: (e) =>
      toast.error("Could not restore", { description: String(e) }),
  });

  return (
    <div data-ai="history" className="flex flex-col">
      <Section
        title="History"
        hint="Every change by the AI, every save, and autosaves now and then."
        aside={
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrompt("save")}
              disabled={!videoPath}
            >
              <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={1.75} />
              Save version
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrompt("duplicate")}
              disabled={!videoPath}
            >
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.75} />
              Duplicate
            </Button>
          </div>
        }
      >
        {versions.isPending ? (
          <Spinner className="size-4" />
        ) : list.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No version yet. ⌘S saves one with a message; the AI's changes and
            autosaves add theirs.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {list.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  data-ai-item={v.id}
                  onClick={() => setSelected(v.id === selected ? null : v.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5",
                    v.id === selected && "bg-white/10",
                  )}
                >
                  <HugeiconsIcon
                    icon={v.author === "ai" ? RobotIcon : UserIcon}
                    size={14}
                    strokeWidth={1.75}
                    className={cn(
                      "mt-0.5 shrink-0",
                      v.author === "ai"
                        ? "text-orange-400"
                        : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]">
                      {titleOf(v)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {when(v.at)}
                      {v.message && v.command ? ` · ${v.command}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {current ? (
        <Section
          title={titleOf(current)}
          hint={`${current.author === "ai" ? "AI" : "Person"} · ${new Date(current.at).toLocaleString()}`}
          aside={
            <Button
              size="sm"
              onClick={() => restore.mutate(current.id)}
              disabled={restore.isPending || (diff ? isEmptyDiff(diff) : true)}
            >
              {restore.isPending ? <Spinner className="size-3" /> : null}
              Restore
            </Button>
          }
        >
          {preview.isPending ? (
            <Spinner className="size-4" />
          ) : preview.isError ? (
            <p className="text-xs text-destructive">{String(preview.error)}</p>
          ) : diff ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {isEmptyDiff(diff)
                ? "The montage on screen matches this version."
                : `Compared with the montage on screen:\n${describeDiff(diff)}`}
            </pre>
          ) : null}
        </Section>
      ) : null}
      <VersionPromptDialog />
    </div>
  );
}

/** One dialog for both prompts: a version's message, or a copy's name. */
function VersionPromptDialog() {
  const prompt = useVersionsUi((s) => s.prompt);
  const setPrompt = useVersionsUi((s) => s.setPrompt);
  const videoPath = useSession((s) => s.videoPath);
  const [text, setText] = useState("");
  const close = () => {
    setPrompt(null);
    setText("");
  };

  const save = useMutation({
    mutationFn: (message: string) =>
      recordVersion(videoPath, {
        author: "person",
        command: "save",
        message: message || undefined,
        state: useEdit.getState().edit,
      }),
    onSuccess: (meta) => {
      if (typeof meta?.id !== "string") return;
      toast.success("Version saved");
      close();
    },
    onError: (e) => toast.error("Could not save", { description: String(e) }),
  });

  const duplicate = useMutation({
    mutationFn: (name: string) => duplicateMontage(videoPath, name || null),
    onSuccess: (path) => {
      if (typeof path !== "string" || !path) return;
      toast.success("New montage created");
      close();
      openPlace({ to: "/editor", search: { video: path } }, { reuse: false });
    },
    onError: (e) =>
      toast.error("Could not duplicate", { description: String(e) }),
  });

  const isSave = prompt === "save";
  const busy = save.isPending || duplicate.isPending;
  const submit = () => {
    if (busy) return;
    if (isSave) save.mutate(text.trim());
    else duplicate.mutate(text.trim());
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isSave ? "Save a version" : "Duplicate as new montage"}
          </DialogTitle>
          <DialogDescription>
            {isSave
              ? "A named version is never pruned. Restore it any time from History."
              : "A copy of this montage with its versions, opened in a new tab. The take itself is shared, not copied."}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={text}
          placeholder={
            isSave ? "What this version is (optional)" : "Name (optional)"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner className="size-3" /> : null}
            {isSave ? "Save version" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
