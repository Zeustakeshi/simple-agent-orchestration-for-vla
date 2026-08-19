/* (app)/layout.tsx — P02 App Shell
   Server Component wrapping <AppShellClient> for interactive parts.
   MASTER §18.1: No 'use client' here. */

import { AppShellClient } from "@/components/layout/AppShellClient";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShellClient>{children}</AppShellClient>;
}
