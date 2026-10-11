import { createRouter } from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen";

// One router for the app; commands run from outside React navigate with it.
export const router = createRouter({ routeTree, context: {} });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
