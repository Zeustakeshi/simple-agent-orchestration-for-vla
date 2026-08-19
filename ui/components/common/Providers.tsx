"use client";
/* Providers — P-SETUP item 3
   TanStack Query for server state, Toaster for non-blocking feedback.
   Kept in a leaf client component so app/layout.tsx stays a Server Component. */

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "./Toaster";
import { ThemeSync } from "./ThemeSync";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
