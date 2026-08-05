"use client";

import { useEffect, useRef, useState } from "react";

import type { Trace } from "@/lib/types";
import { Score } from "./ui";

/**
 * During a voice call the retrieval step happens between Vapi and the backend,
 * never in this tab. These panels are the backend's own trace of that step,
 * which is the only honest way to show what the spoken answer was built from.
 */
export function Sources({ traces }: { traces: Trace[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const latest = traces[traces.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [latest?.id]);

  if (traces.length === 0) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center">
        <p className="max-w-[28ch] text-[14px] leading-relaxed text-faint">
          The passages behind each answer appear here the moment they are retrieved.
        </p>
      </div>
    );
  }

  return (
    <div className="scroller flex h-full flex-col gap-5 overflow-y-auto pr-1">
      {traces.map((trace) => (
        <TraceCard key={trace.id} trace={trace} open={trace.id === latest?.id} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function TraceCard({ trace, open }: { trace: Trace; open: boolean }) {
  return (
    <section className="rise">
      <header className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="truncate text-[13px] font-medium text-ink">
          {trace.question}
        </p>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
          {trace.retrieval_ms} ms
        </span>
      </header>

      {trace.sources.length === 0 ? (
        <p className="text-[13px] text-faint">
          Nothing in the knowledge base passed the relevance floor.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {trace.sources.map((source, index) => (
            <SourceRow
              key={`${trace.id}-${index}`}
              index={index + 1}
              source={source}
              defaultOpen={open && index === 0}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function SourceRow({
  index,
  source,
  defaultOpen,
}: {
  index: number;
  source: { title: string; score: number; chunk_index: number; text: string };
  defaultOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <li className="overflow-hidden rounded-[14px] border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ink/4"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/8 font-mono text-[10px] text-muted">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {source.title}
          </span>
          <span className="text-[11px] text-faint">chunk {source.chunk_index}</span>
        </span>
        <Score value={source.score} />
      </button>

      {expanded ? (
        <p className="border-t border-hairline px-3.5 py-3 text-[13px] leading-[1.6] text-muted">
          {source.text}
        </p>
      ) : null}
    </li>
  );
}
