"use client";

import { useEffect, type ReactNode } from "react";
import Workspace from "./workspace";
import { demoMode } from "../lib/supabase";

export default function HomeEntry({ children }: { children: ReactNode }) {
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    // Existing Supabase emails redirect to the root. Preserve the complete
    // callback so the workspace can finish invitation and recovery sessions.
    if (hash.has("access_token") || hash.has("error") || query.has("code")) {
      window.location.replace(`/workspace${window.location.search}${window.location.hash}`);
    }
  }, []);

  return demoMode ? <Workspace /> : children;
}
