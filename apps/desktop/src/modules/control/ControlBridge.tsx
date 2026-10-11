import {
  AiBrain01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { registerCommands } from "./commands";
import { runCommand, titleOf, useActivity } from "./registry";

const requestSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  input: z.unknown(),
});

/** Runs what an AI asks (via the control server) and shows it to the person. */
export function ControlBridge() {
  useEffect(() => {
    // Registering again only replaces entries: after a code reload, the
    // commands run the new code.
    registerCommands();
    let off: (() => void) | null = null;
    let alive = true;
    void listen("control-request", async (e) => {
      const req = requestSchema.safeParse(e.payload);
      if (!req.success) return;
      const { id, command, input } = req.data;
      const quiet = command === "control.catalog" || command === "tasks.wait";
      const { push, settle } = useActivity.getState();
      if (!quiet)
        push({
          id,
          at: Date.now(),
          command,
          title: titleOf(command),
          ok: null,
          error: null,
        });
      const answer = await runCommand(command, input);
      if (!quiet) settle(id, answer.ok, answer.ok ? null : answer.error);
      await ipc.controlReply(id, answer).catch(() => {});
    }).then((un) => {
      if (alive) off = un;
      else un();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return <AiActivity />;
}

function AiActivity() {
  const entries = useActivity((s) => s.entries);
  const open = useActivity((s) => s.panelOpen);
  const setOpen = useActivity.getState().setPanelOpen;
  const busy = entries.some((e) => e.ok === null);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur hover:bg-popover",
          entries.length === 0 && "opacity-70",
        )}
      >
        {busy ? (
          <Spinner className="size-3.5" />
        ) : (
          <HugeiconsIcon icon={AiBrain01Icon} size={15} />
        )}
        {busy
          ? `AI · ${entries.find((e) => e.ok === null)?.title}`
          : entries.length > 0
            ? `AI · ${entries[0].title}`
            : "Connect an AI"}
      </button>
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-black/30 p-2 font-mono text-[11px] whitespace-pre">
          {text}
        </pre>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={() =>
            void navigator.clipboard.writeText(text).catch(() => {})
          }
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const info = useQuery({
    queryKey: ["control-info"],
    queryFn: ipc.controlInfo,
    enabled: open,
  });
  const entries = useActivity((s) => s.entries);
  const server =
    info.data?.mcpServer || "<goScreen>/packages/mcp-server/server.mjs";
  const cli = info.data?.cli || "<goScreen>/packages/mcp-server/cli.mjs";
  const skill = info.data?.skill || "<goScreen>/skills/goscreen";
  const desktopConfig = JSON.stringify(
    { mcpServers: { goscreen: { command: "node", args: [server] } } },
    null,
    2,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect an AI</DialogTitle>
          <DialogDescription>
            Your assistant (Claude or any MCP client) can run every goScreen
            action: inspect a site, write the VSL, simulate, record, edit and
            export. It works on this machine only, with a private key goScreen
            writes for you. You see each action here and can undo montage
            changes with ⌘Z.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          {info.data ? (
            <>
              <span className="size-2 rounded-full bg-emerald-400" />
              Ready on 127.0.0.1:{info.data.port}
            </>
          ) : (
            <>
              <span className="size-2 rounded-full bg-amber-400" />
              Starting…
            </>
          )}
        </div>

        <Snippet
          label="Claude Code: add the server"
          text={`claude mcp add goscreen -- node "${server}"`}
        />
        <Snippet
          label="Claude Code: add the skill (how to make a VSL)"
          text={`mkdir -p ~/.claude/skills && cp -R "${skill}" ~/.claude/skills/`}
        />
        <Snippet
          label="Claude Desktop, Cursor and other MCP clients (config file)"
          text={desktopConfig}
        />
        <Snippet
          label="Command line (scripts, other agents)"
          text={`node "${cli}" projects.list\nnode "${cli}" site.inspect '{"url":"https://example.com"}'`}
        />
        <p className="text-[11px] text-muted-foreground">
          Then ask, for example: “Make a 60-second vertical VSL of
          https://my-site.com for new buyers, from search to payment.” goScreen
          must stay open while the AI works.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            What the AI did ({entries.length})
          </span>
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet.</p>
          ) : (
            <div className="flex max-h-60 flex-col divide-y overflow-y-auto rounded-md border">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs"
                >
                  {e.ok === null ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <HugeiconsIcon
                      icon={e.ok ? CheckmarkCircle02Icon : Cancel01Icon}
                      size={14}
                      className={e.ok ? "text-emerald-400" : "text-destructive"}
                    />
                  )}
                  <span className="font-medium">{e.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {e.command}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(e.at).toLocaleTimeString()}
                  </span>
                  {e.error ? (
                    <span className="basis-full text-[11px] text-destructive">
                      {e.error}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
