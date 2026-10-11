import { QueryClient } from "@tanstack/react-query";

// Shared so background work (tasks) can refresh lists when it finishes.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});
