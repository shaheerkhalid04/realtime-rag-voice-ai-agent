"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getTraces } from "./api";
import type { Trace, Turn } from "./types";

export type Phase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

const BUILD_TIME_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const LLM_ORIGIN = process.env.NEXT_PUBLIC_RAG_LLM_ORIGIN ?? "";

/** Where Vapi's servers should POST each turn. They cannot reach localhost. */
export function llmOrigin(): string {
  if (LLM_ORIGIN) return LLM_ORIGIN.replace(/\/$/, "");
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function originIsReachable(origin: string): boolean {
  return !!origin && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(origin);
}

/**
 * The assistant is built inline rather than in the Vapi dashboard so the whole
 * configuration lives in the repository and moves with a deployment. The one
 * line that matters is `provider: "custom-llm"` - it makes Vapi call this app's
 * FastAPI endpoint for every turn instead of an off-the-shelf model, which is
 * where retrieval gets injected.
 */
function assistantConfig(origin: string, model: string) {
  return {
    name: "Attune",
    firstMessage:
      "I'm listening. Ask me anything from the documents you've added.",
    firstMessageMode: "assistant-speaks-first" as const,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    backgroundDenoisingEnabled: true,
    transcriber: {
      provider: "deepgram" as const,
      model: "nova-2",
      language: "en" as const,
      // Punctuated partials read far better in a live transcript.
      smartFormat: true,
    },
    model: {
      provider: "custom-llm" as const,
      // Vapi appends /chat/completions to this.
      url: `${origin}/api/py`,
      // Reported by /health; the backend always answers with its own GROQ_MODEL.
      model,
      // The real system prompt is applied server-side alongside the retrieved
      // context; this is only what Vapi shows in its own logs.
      messages: [
        {
          role: "system" as const,
          content:
            "Answer only from the retrieved knowledge base passages supplied by the backend.",
        },
      ],
    },
    voice: {
      provider: "vapi" as const,
      voiceId: "Elliot",
    },
  };
}

type VapiMessage = {
  type?: string;
  role?: string;
  transcript?: string;
  transcriptType?: string;
};

/**
 * The surface of the SDK this hook actually touches. Declared structurally
 * rather than imported, because importing the class type at module scope would
 * pull the browser-only package into the server bundle.
 */
type VapiClient = {
  on(event: string, handler: (payload: never) => void): void;
  start(config: never): Promise<{ id?: string } | null>;
  stop(): void;
  setMuted(muted: boolean): void;
};

/**
 * @param servedKey Vapi's public key as reported by /health. Falls back to a
 *   build-time NEXT_PUBLIC_ value, so either way of configuring it works.
 */
export function useAssistant(
  servedKey?: string | null,
  servedAssistantId?: string | null,
  servedModel?: string | null,
) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [partial, setPartial] = useState<{ role: string; text: string } | null>(null);

  const vapiRef = useRef<VapiClient | null>(null);

  const publicKey = BUILD_TIME_KEY || servedKey || "";
  const configured = !!publicKey;
  const origin = llmOrigin();

  const push = useCallback((role: "user" | "assistant", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTurns((previous) => {
      const last = previous[previous.length - 1];
      // Deepgram emits one final per utterance segment, so a single spoken
      // sentence can arrive in pieces. Folding consecutive same-role finals
      // into one turn keeps the transcript readable.
      if (last && last.role === role && Date.now() - last.at < 12_000) {
        const merged = [...previous];
        merged[merged.length - 1] = {
          ...last,
          text: `${last.text} ${clean}`.replace(/\s+/g, " "),
          at: Date.now(),
        };
        return merged;
      }
      return [
        ...previous,
        {
          id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role,
          text: clean,
          final: true,
          at: Date.now(),
        },
      ];
    });
  }, []);

  const stop = useCallback(() => {
    vapiRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (!configured) {
      setError("Set VAPI_PUBLIC_KEY on the backend to enable voice.");
      setPhase("error");
      return;
    }
    if (!originIsReachable(origin)) {
      setError(
        "Vapi's servers have to reach the retrieval endpoint over the public internet. " +
          "Set NEXT_PUBLIC_RAG_LLM_ORIGIN to the deployed URL (or an ngrok tunnel) and reload.",
      );
      setPhase("error");
      return;
    }

    setError(null);
    setTurns([]);
    setTraces([]);
    setPartial(null);
    setPhase("connecting");

    try {
      // The SDK reaches for microphone and WebRTC APIs on construction, so it
      // is only ever loaded in the browser, on demand.
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(publicKey) as unknown as VapiClient;
      vapiRef.current = vapi;

      vapi.on("call-start", () => setPhase("listening"));
      vapi.on("speech-start", () => setPhase("speaking"));
      vapi.on("speech-end", () => setPhase("listening"));
      vapi.on("volume-level", (level: number) => setVolume(level));

      vapi.on("call-end", () => {
        setPhase("idle");
        setVolume(0);
        setPartial(null);
        vapiRef.current = null;
      });

      vapi.on("error", (event: unknown) => {
        const message =
          (event as { errorMsg?: string })?.errorMsg ??
          (event as { message?: string })?.message ??
          "The call ended unexpectedly.";
        setError(String(message));
        setPhase("error");
      });

      vapi.on("message", (message: VapiMessage) => {
        if (message.type !== "transcript" || !message.transcript) return;
        const role = message.role === "assistant" ? "assistant" : "user";

        if (message.transcriptType === "final") {
          setPartial(null);
          push(role, message.transcript);
          // A finished question means the backend is now retrieving, which is
          // the one moment the interface can honestly say it is thinking.
          if (role === "user") setPhase("thinking");
        } else {
          setPartial({ role, text: message.transcript });
        }
      });

      // A dashboard assistant carries the x-vapi-secret header server side, so the secret
      // never reaches the browser. Without one, fall back to the inline config.
      const call = servedAssistantId
        ? await vapi.start(servedAssistantId as never)
        : await vapi.start(assistantConfig(origin, servedModel || "openai/gpt-oss-120b") as never);
      setCallId(call?.id ?? null);
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Could not start the call. Check the microphone permission.",
      );
      setPhase("error");
    }
  }, [configured, origin, publicKey, push, servedAssistantId, servedModel]);

  const toggleMute = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    const next = !muted;
    vapi.setMuted(next);
    setMuted(next);
  }, [muted]);

  // Retrieval happens between Vapi and the backend, never in this tab. Polling
  // the trace the backend wrote is what lets the sources panel show the exact
  // passages behind the sentence currently being spoken.
  const active = phase !== "idle" && phase !== "error";
  useEffect(() => {
    if (!callId || !active) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const { traces: fetched } = await getTraces(callId);
        if (!cancelled) setTraces(fetched);
      } catch {
        /* a missed poll is replaced by the next one */
      }
    };

    pull();
    const timer = setInterval(pull, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [callId, active]);

  useEffect(() => () => vapiRef.current?.stop(), []);

  return {
    phase,
    error,
    turns,
    partial,
    traces,
    volume,
    muted,
    callId,
    configured,
    origin,
    start,
    stop,
    toggleMute,
    addTurn: push,
  };
}
