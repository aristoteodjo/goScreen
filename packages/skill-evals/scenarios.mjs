// What a model is asked to make with the goscreen skill, and how the result
// is scored (options of score.mjs). Prompts are what the person would say.

export const SCENARIOS = [
  {
    id: "ad-9x16",
    title: "Product ad, 9:16, three imposed phrases",
    needs: "video",
    prompt: [
      "Make a 9:16 product ad for a SaaS that collects supplier invoices in one inbox, from the open take.",
      'These three phrases must appear on screen, each as a scene title: "Every invoice, one inbox", "Paid in 2 clicks", "3 days faster".',
      "Premium screen look, a moving backdrop in the brand's colour (#4cc2ff on dark grey), a call to action card at the end. 15 to 30 seconds.",
    ].join(" "),
    options: {
      aspect: "9:16",
      duration: [15, 30],
      phrases: [
        "Every invoice, one inbox",
        "Paid in 2 clicks",
        "3 days faster",
      ],
    },
  },
  {
    id: "launch-16x9",
    title: "Launch film, 16:9",
    needs: "video",
    prompt: [
      "Make a 16:9 launch film for a roadmap tool called Orbit from the open take: a hook, the product in use, two or three features with a figure each, a short call to action.",
      "Chapter kickers, waves backdrop, 45 to 70 seconds.",
    ].join(" "),
    options: { aspect: "16:9", duration: [45, 70] },
  },
  {
    id: "proof-1x1",
    title: "Proof clip, 1:1",
    needs: "video",
    prompt: [
      "Make a 1:1 proof clip from the open take: three figures, one per scene (12 000 teams, setup in 9 minutes, 98 % renew), each as the scene title with the figure accented, a source note under each, and a call to action.",
      "Quiet flat look with the framed device. 15 to 30 seconds.",
    ].join(" "),
    options: {
      aspect: "1:1",
      duration: [15, 30],
      phrases: ["12 000", "9 minutes", "98 %"],
    },
  },
  {
    id: "explainer-voice",
    title: "Explainer with a voice-over",
    needs: "video",
    prompt: [
      "The open take has a voice-over on an audio track. Make a 16:9 explainer: clean the voice's silences, let the voice lead the cut, one caption per phrase that completes the voice without repeating it, a counter for every figure said, a call to action at the end.",
      "60 to 120 seconds.",
    ].join(" "),
    options: { aspect: "16:9", duration: [60, 120] },
  },
  {
    id: "dynamic-ad",
    title: "Dynamic product ad, 16:9 (SaaS motion look)",
    needs: "video",
    prompt: [
      "Make a 16:9 product ad from the open take in the dynamic look of the SaaS motion references: wordmark and hook on a beam of the brand colour (#5b8cff on near-black), the product as a 3D object, two features as scenes (a chat that types, floating cards) with the real screen between them, a figure counting up, a short call to action.",
      "Nothing still for 2 seconds, no dry cut, a sound on every movement over a rhythmic music bed. 15 to 30 seconds.",
    ].join(" "),
    options: { aspect: "16:9", duration: [15, 30], dynamic: true, scenes: 3 },
  },
  {
    id: "vsl-site",
    title: "VSL of a public site",
    needs: "site",
    site: "https://demo.playwright.dev/todomvc",
    prompt: [
      "Film a VSL of https://demo.playwright.dev/todomvc on a phone: a project, a VSL with three scenes (add two tasks, complete one, filter the active ones), simulate, record, then polish the montage with the quality rules.",
      "9:16, 20 to 45 seconds, call to action at the end. Confirm nothing: this is a demo site.",
    ].join(" "),
    options: { aspect: "9:16", duration: [20, 45] },
  },
];

export const scenario = (id) => SCENARIOS.find((s) => s.id === id) ?? null;
