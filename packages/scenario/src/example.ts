// A scenario that runs anywhere: Playwright's public TodoMVC demo. Shown by
// "Insert example" so the format is learnt from something that works.
export const EXAMPLE_SCENARIO = {
  version: 1,
  name: "Todo demo",
  url: "https://demo.playwright.dev/todomvc/",
  device: { id: "macbook-air-13" },
  locale: "en-US",
  vars: {
    task: { label: "First task", default: "Record a product video" },
  },
  mask: [],
  film: {
    aspect: "16:9",
    background: "#f4f1ea",
    ink: "#16241c",
    accent: "#e9a100",
    font: "Inter",
    captions: "top",
    zoom: 1.35,
    intro: {
      title: "Plan your day in seconds",
      subtitle: "A scripted take, edited by goScreen",
      duration: 3,
    },
    outro: { title: "Done. Next?", subtitle: "", duration: 2.5 },
  },
  steps: [
    { do: "goto", url: "https://demo.playwright.dev/todomvc/" },
    { do: "scene", caption: "Write what needs doing" },
    {
      do: "type",
      target: { placeholder: "What needs to be done?" },
      text: "{{task}}",
    },
    { do: "press", key: "Enter" },
    {
      do: "type",
      target: { placeholder: "What needs to be done?" },
      text: "Share it with the team",
    },
    { do: "press", key: "Enter" },
    { do: "wait", ms: 800 },
    { do: "scene", caption: "Tick it off when it is done" },
    { do: "tap", target: { role: "checkbox", name: "Toggle Todo", nth: 0 } },
    { do: "wait", ms: 800 },
    { do: "tap", target: { role: "link", name: "Completed" } },
    { do: "wait", ms: 1200 },
  ],
} as const;
