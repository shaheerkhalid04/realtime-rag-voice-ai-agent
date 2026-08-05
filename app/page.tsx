"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Orb, PhaseLabel } from "@/components/orb";
import { Sources } from "@/components/sources";
import { Transcript } from "@/components/transcript";
import { Button, Chip, Notice } from "@/components/ui";
import { getHealth, sendChat } from "@/lib/api";
import type { Health, Trace } from "@/lib/types";
import { originIsReachable, useAssistant } from "@/lib/useAssistant";

export default function AssistantPage() {
  const [health, setHealth] = useState<Health | null>(null);
  // Vapi's public key is served by /health rather than baked in at build time,
  // so the backend is the single place it is configured.
  const assistant = useAssistant(health?.vapi_public_key);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [typedTraces, setTypedTraces] = useState<Trace[]>([]);
  const [typedError, setTypedError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // A typed question runs the identical retrieval and prompt as a spoken one, so
  // its result belongs in the same panel rather than a parallel history.
  const traces = useMemo(
    () => [...assistant.traces, ...typedTraces].sort((a, b) => a.ts - b.ts),
    [assistant.traces, typedTraces],
  );

  const live = assistant.phase !== "idle" && assistant.phase !== "error";

  const ask = useCallback(async () => {
    const question = typed.trim();
    if (!question || sending) return;

    setTyped("");
    setTypedError(null);
    setSending(true);
    assistant.addTurn("user", question);

    try {
      const history = assistant.turns.map((turn) => ({
        role: turn.role,
        content: turn.text,
      }));
      const reply = await sendChat([...history, { role: "user", content: question }]);
      assistant.addTurn("assistant", reply.answer);
      setTypedTraces((previous) => [
        ...previous,
        {
          id: `typed-${Date.now()}`,
          ts: Date.now(),
          question,
          retrieval_ms: reply.timings.retrieval_ms,
          sources: reply.sources.map((source) => ({
            title: source.title,
            score: source.score,
            chunk_index: source.chunk_index,
            text: source.text.slice(0, 600),
          })),
        },
      ]);
    } catch (exception) {
      setTypedError(
        exception instanceof Error ? exception.message : "That question failed.",
      );
    } finally {
      setSending(false);
    }
  }, [assistant, sending, typed]);

  const emptyKnowledge = health ? health.documents === 0 : false;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-5xl px-5 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
        <p className="eyebrow rise">Real-time voice · RAG</p>
        <h1 className="headline rise mt-4 text-[clamp(2.5rem,1.6rem+4.2vw,4.5rem)]">
          Ask out loud.
        </h1>
        <p className="subhead rise mx-auto mt-5 max-w-[46ch]">
          Attune listens, searches your own documents, and answers in a natural voice —
          saying only what those documents support.
        </p>

        <div className="mt-10 flex flex-col items-center gap-6 sm:mt-12">
          <Orb phase={assistant.phase} volume={assistant.volume} />

          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-3">
              {live ? (
                <>
                  <Button size="lg" variant="danger" onClick={assistant.stop}>
                    End call
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    onClick={assistant.toggleMute}
                    aria-pressed={assistant.muted}
                  >
                    {assistant.muted ? "Unmute" : "Mute"}
                  </Button>
                </>
              ) : (
                <Button size="lg" onClick={assistant.start}>
                  Start talking
                </Button>
              )}
            </div>
            <PhaseLabel phase={assistant.phase} />
          </div>

          <Status health={health} />
        </div>

        <div className="mx-auto mt-8 max-w-xl space-y-3 text-left">
          {assistant.error ? (
            <Notice title="Voice call">{assistant.error}</Notice>
          ) : null}

          {health && !assistant.configured ? (
            <Notice title="Voice is not configured yet">
              Set <code className="font-mono text-[13px]">VAPI_PUBLIC_KEY</code> from the
              Vapi dashboard to enable spoken calls. Typed questions below run the same
              retrieval pipeline in the meantime.
            </Notice>
          ) : assistant.configured && !originIsReachable(assistant.origin) ? (
            <Notice title="Set a public URL for the retrieval endpoint">
              Vapi calls the language model from its own servers, so it cannot reach{" "}
              <code className="font-mono text-[13px]">localhost</code>. Point{" "}
              <code className="font-mono text-[13px]">NEXT_PUBLIC_RAG_LLM_ORIGIN</code> at
              the deployed app or a tunnel.
            </Notice>
          ) : null}

          {emptyKnowledge ? (
            <Notice tone="accent" title="The knowledge base is empty">
              Attune has nothing to answer from yet.{" "}
              <Link href="/knowledge" className="text-accent underline underline-offset-2">
                Add a document
              </Link>{" "}
              and it will start answering.
            </Notice>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Console                                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-5xl px-5 pb-6 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex h-[26rem] flex-col rounded-[20px] border border-hairline bg-raised">
            <PanelHead title="Conversation">
              {live ? <Chip tone="accent">live</Chip> : null}
            </PanelHead>

            <div className="min-h-0 flex-1 px-4 py-4">
              <Transcript
                turns={assistant.turns}
                partial={assistant.partial}
                pending={sending}
              />
            </div>

            <div className="border-t border-hairline p-3">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  ask();
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="Or type a question…"
                  aria-label="Type a question"
                  className="min-w-0 flex-1 rounded-full border border-hairline bg-surface px-4 py-2.5
                    text-[15px] text-ink placeholder:text-faint focus:outline-none
                    focus-visible:border-accent"
                />
                <Button type="submit" disabled={!typed.trim() || sending}>
                  {sending ? "Asking" : "Ask"}
                </Button>
              </form>
              {typedError ? (
                <p className="px-2 pt-2 text-[13px] text-warn">{typedError}</p>
              ) : null}
            </div>
          </div>

          <div className="flex h-[26rem] flex-col rounded-[20px] border border-hairline bg-raised">
            <PanelHead title="Retrieved passages">
              {health ? (
                <span className="font-mono text-[11px] text-faint">
                  top {health.top_k}
                </span>
              ) : null}
            </PanelHead>
            <div className="min-h-0 flex-1 px-4 py-4">
              <Sources traces={traces} />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Closing                                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-5xl px-5 py-20 sm:px-6">
        <div className="grid gap-10 border-t border-hairline pt-14 sm:grid-cols-3">
          <Point title="Grounded, not improvised">
            Every spoken turn is retrieved against your documents first. With nothing
            relevant to cite, Attune says so instead of inventing an answer.
          </Point>
          <Point title="Answers begin mid-thought">
            Tokens stream to the speech engine as they are generated, so the reply
            starts being spoken before it has finished being written.
          </Point>
          <Point title="You can see the evidence">
            The passages behind each answer appear beside the transcript, with their
            similarity scores, while the answer is still being said.
          </Point>
        </div>
      </section>
    </>
  );
}

function PanelHead({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
      <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
      {children}
    </div>
  );
}

function Status({ health }: { health: Health | null }) {
  if (!health) return null;

  if (health.missing.length > 0) {
    return (
      <p className="text-[13px] text-warn">
        Backend is missing {health.missing.join(" and ")}.
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] text-faint">
      <span>
        {health.documents} document{health.documents === 1 ? "" : "s"}
      </span>
      <Dot />
      <span>{health.chunks.toLocaleString()} passages indexed</span>
      <Dot />
      <span className="font-mono">{health.model}</span>
    </p>
  );
}

function Dot() {
  return <span aria-hidden>·</span>;
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[14px] leading-[1.6] text-muted">{children}</p>
    </div>
  );
}
