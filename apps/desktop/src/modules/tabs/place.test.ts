import { describe as suite, expect, it } from "vitest";
import { describe } from "./place";

suite("tab places", () => {
  it("names a tab after what it shows", () => {
    expect(
      describe("/editor?video=%2FUsers%2Fme%2FMovies%2Foeufdor-acheteur.mp4"),
    ).toEqual({ kind: "editor", title: "oeufdor-acheteur" });
    expect(
      describe(
        "/editor?video=%2FUsers%2Fme%2FProjects%2Facme%2Flaunch.edit.json",
      ),
    ).toEqual({ kind: "editor", title: "launch" });
    expect(describe("/flow?project=demo&vsl=buyer")).toEqual({
      kind: "flow",
      title: "buyer",
    });
    expect(describe("/projects/my%20film")).toEqual({
      kind: "project",
      title: "my film",
    });
    expect(describe("/studio")).toEqual({ kind: "studio", title: "Studio" });
    expect(describe("/reproduce")).toEqual({
      kind: "reproduce",
      title: "Reproduce",
    });
    expect(describe("/")).toEqual({ kind: "home", title: "Projects" });
  });
});
