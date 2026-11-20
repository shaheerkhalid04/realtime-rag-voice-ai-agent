"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";

/** The generation model as the backend reports it, so this page never goes stale. */
export function LiveModel() {
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => !cancelled && setModel(h.model))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return <>Groq, {model ?? "model set by GROQ_MODEL"}, streamed</>;
}
