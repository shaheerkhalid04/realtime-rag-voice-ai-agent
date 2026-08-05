"use client";

import type { Phase } from "@/lib/useAssistant";

const LABEL: Record<Phase, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Searching your documents",
  speaking: "Speaking",
  error: "Something went wrong",
};

/**
 * The one piece of the interface that is allowed to move. It reads live mic and
 * speaker levels from the Vapi SDK, so the scale is genuine feedback rather than
 * decoration - if the orb is not responding, neither is the microphone.
 */
export function Orb({ phase, volume }: { phase: Phase; volume: number }) {
  const live = phase === "listening" || phase === "speaking";
  const amplitude = live ? Math.min(1, volume * 2.6) : 0;
  const scale = 1 + amplitude * 0.16;
  const halo = 1 + amplitude * 0.5;

  const dim = phase === "idle" || phase === "error";

  return (
    <div className="relative flex size-[260px] items-center justify-center sm:size-[300px]">
      {/* Halo */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full blur-[42px] transition-[transform,opacity] duration-300 ease-out"
        style={{
          opacity: dim ? 0.16 : 0.42 + amplitude * 0.35,
          transform: `scale(${halo})`,
          background:
            "radial-gradient(circle at 50% 50%, var(--glow-a) 0%, var(--glow-b) 45%, transparent 68%)",
        }}
      />

      {/* Sphere */}
      <div
        className="relative size-[168px] rounded-full transition-[transform] duration-200 ease-out sm:size-[196px]"
        style={{ transform: `scale(${scale})` }}
      >
        <div
          aria-hidden
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{
            boxShadow: dim
              ? "inset 0 1px 0 rgb(255 255 255 / 0.16), 0 20px 60px rgb(0 0 0 / 0.14)"
              : "inset 0 1px 0 rgb(255 255 255 / 0.28), 0 24px 70px rgb(0 0 0 / 0.18)",
          }}
        >
          <div
            className="absolute -inset-1/2"
            style={{
              opacity: dim ? 0.32 : 1,
              transition: "opacity 600ms ease",
              background:
                "conic-gradient(from 0deg, var(--glow-a), var(--glow-b), var(--glow-c), var(--glow-a))",
              filter: "blur(18px)",
              animation: `drift ${phase === "speaking" ? 6 : 16}s linear infinite`,
            }}
          />
          {/* Glass */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(120% 90% at 30% 18%, rgb(255 255 255 / 0.42) 0%, rgb(255 255 255 / 0.06) 42%, transparent 70%)",
            }}
          />
        </div>

        {/* Thinking ring */}
        <div
          aria-hidden
          className="absolute -inset-3 rounded-full border transition-opacity duration-500"
          style={{
            opacity: phase === "thinking" || phase === "connecting" ? 1 : 0,
            borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
            animation: "breathe 1.6s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}

/** The visible phase caption, and the one place it is announced. */
export function PhaseLabel({ phase }: { phase: Phase }) {
  const busy = phase === "thinking" || phase === "connecting";
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-[13px] font-medium tracking-tight ${
        busy ? "thinking" : phase === "error" ? "text-warn" : "text-muted"
      }`}
    >
      {LABEL[phase]}
    </p>
  );
}
