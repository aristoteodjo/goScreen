// MCP over stdio (JSON-RPC 2.0, one message per line), without a dependency.
// Tools are the app's commands, fetched from it: the server never drifts.

export const SERVER_INFO = { name: "goscreen", version: "0.1.0" };
const PROTOCOL = "2025-06-18";

export const INSTRUCTIONS = [
  "goScreen turns real websites into product videos (VSLs).",
  "Start with help_formats once, then: site_inspect a page to get ready-made targets,",
  "projects_create / vsl_create, vsl_save the flow (scenes with captions and steps),",
  "tasks_simulate and tasks_wait to check each journey, fix failing nodes,",
  "tasks_record and tasks_wait, then edit_get / edit_save to polish and export_video.",
  "Simulations and recordings act on the real site: tell the person before running them.",
].join(" ");

/** MCP tool names allow [a-zA-Z0-9_-]: dots become underscores. */
export const toolName = (command) => command.replaceAll(".", "_");

export function toTool(c) {
  const { $schema: _s, ...schema } = c.inputSchema ?? {};
  return {
    name: toolName(c.name),
    title: c.title,
    description: c.destructive
      ? `${c.description} Acts on real data: ask the person first if unsure.`
      : c.description,
    inputSchema:
      schema.type === "object" ? schema : { type: "object", properties: {} },
    annotations: { destructiveHint: !!c.destructive, readOnlyHint: false },
  };
}

/** The MCP answer for a command result (images become image content). */
export function toContent(answer) {
  if (!answer.ok) {
    const issues = answer.issues?.length ? `\n${answer.issues.join("\n")}` : "";
    return {
      isError: true,
      content: [{ type: "text", text: `${answer.error}${issues}` }],
    };
  }
  const result = answer.result;
  const content = [];
  if (
    result &&
    typeof result === "object" &&
    typeof result.screenshot === "string"
  ) {
    const { screenshot, ...rest } = result;
    content.push({ type: "text", text: JSON.stringify(rest, null, 1) });
    content.push({ type: "image", data: screenshot, mimeType: "image/jpeg" });
  } else {
    content.push({
      type: "text",
      text: JSON.stringify(result, null, 1) ?? "null",
    });
  }
  return { content };
}

/**
 * Handles one JSON-RPC message; returns the reply (or null for a
 * notification). `deps.call(command, input)` reaches the app.
 */
export async function handle(msg, deps) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code, message },
  });
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return msg?.id !== undefined ? fail(-32600, "Invalid request") : null;
  const notification = msg.id === undefined;
  try {
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return reply({});
      case "tools/list": {
        const answer = await deps.call("control.catalog", {});
        if (!answer.ok) return fail(-32603, answer.error);
        return reply({ tools: answer.result.map(toTool) });
      }
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const answer = await deps.call(
          name.replaceAll("_", "."),
          msg.params?.arguments ?? {},
        );
        return reply(toContent(answer));
      }
      default:
        return notification
          ? null
          : fail(-32601, `Unknown method ${msg.method}`);
    }
  } catch (e) {
    // The app is closed: tell the model plainly, as a tool error.
    if (msg.method === "tools/call")
      return reply({
        isError: true,
        content: [{ type: "text", text: String(e.message ?? e) }],
      });
    return notification ? null : fail(-32603, String(e.message ?? e));
  }
}
