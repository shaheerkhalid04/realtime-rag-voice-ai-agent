"use client";

import { useEffect, useRef } from "react";

import type { Turn } from "@/lib/types";

export function Transcript({
  turns,
  partial,
  pending,
}: {
  turns: Turn[];
  partial: { role: string; text: string } | null;
  pending?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, partial, pending]);

  const empty = turns.length === 0 && !partial && !pending;

  return (
    <div className="scroller flex h-full flex-col gap-4 overflow-y-auto pr-1">
      {empty ? (
        <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center">
          <p className="max-w-[26ch] text-[14px] leading-relaxed text-faint">
            Everything said in the call appears here, as it is said.
          </p>
        </div>
      ) : null}

      {turns.map((turn) => (
        <Bubble key={turn.id} role={turn.role} text={turn.text} />
      ))}

      {partial ? (
        <Bubble
          role={partial.role === "assistant" ? "assistant" : "user"}
          text={partial.text}
          faded
        />
      ) : null}

      {pending ? (
        <div className="flex justify-start">
          <span className="thinking text-[15px]">Retrieving…</span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  role,
  text,
  faded,
}: {
  role: "user" | "assistant";
  text: string;
  faded?: boolean;
}) {
  const mine = role === "user";
  return (
    <div className={`rise flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${faded ? "opacity-55" : ""}`}>
        <p
          className={`mb-1 text-[11px] font-medium tracking-wide uppercase text-faint ${
            mine ? "text-right" : ""
          }`}
        >
          {mine ? "You" : "Attune"}
        </p>
        <div
          className={`rounded-[18px] px-4 py-2.5 text-[15px] leading-[1.5] ${
            mine
              ? "bg-accent text-accent-ink"
              : "border border-hairline bg-surface text-ink"
          }`}
        >
          {text}
        </div>
      </div>
    </div>
  );
}
