import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works — Attune",
  description:
    "The path a spoken question takes: Vapi transcribes it, Pinecone retrieves the passages that matter, Groq writes the answer, and Vapi speaks it back as it streams.",
};

const STEPS = [
  {
    n: "01",
    title: "You speak",
    body: "Vapi opens a WebRTC call in the browser and streams your microphone to a speech-to-text model, emitting partial transcripts as you talk and a final one the moment you stop.",
    tag: "Vapi · Deepgram",
  },
  {
    n: "02",
    title: "Vapi asks this app for the answer",
    body: "The assistant is configured with a custom language model, so instead of calling a hosted model Vapi POSTs an OpenAI-shaped request to /api/py/chat/completions on this deployment. That substitution is the whole integration.",
    tag: "custom-llm",
  },
  {
    n: "03",
    title: "The question is retrieved against your documents",
    body: "The turn is embedded and matched against the passage index. Anything below the relevance floor is dropped, so a question your documents cannot answer arrives at the model with nothing to work from — on purpose.",
    tag: "Pinecone",
  },
  {
    n: "04",
    title: "An answer is written from those passages only",
    body: "The retrieved passages become the model's entire world, under a prompt tuned for speech: a few sentences, no markdown, no citation brackets, figures read out in full. Tokens stream out as they are produced.",
    tag: "Groq · Llama 3.3 70B",
  },
  {
    n: "05",
    title: "You hear it before it is finished",
    body: "Vapi synthesises speech from the stream rather than the finished completion, so the reply starts playing while the rest of it is still being written — and the passages behind it appear next to the transcript at the same time.",
    tag: "Vapi TTS",
  },
];

const STACK = [
  ["Voice", "Vapi — WebRTC transport, speech-to-text, turn-taking, text-to-speech"],
  ["Retrieval", "Pinecone serverless — vectors and hosted llama-text-embed-v2 embeddings"],
  ["Generation", "Groq — llama-3.3-70b-versatile, streamed"],
  ["Backend", "FastAPI on a Python serverless function"],
  ["Frontend", "Next.js App Router, React, Tailwind"],
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-5 pt-16 pb-8 text-center sm:px-6 sm:pt-20">
        <p className="eyebrow rise">Under the hood</p>
        <h1 className="headline rise mt-4 text-[clamp(2.25rem,1.5rem+3.4vw,3.75rem)]">
          One question, five hops.
        </h1>
        <p className="subhead rise mx-auto mt-5 max-w-[52ch]">
          A spoken question becomes a spoken answer in roughly a second and a half. This
          is where that time goes, and where the grounding happens.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-5 sm:px-6">
        <Pipeline />
      </section>

      <section className="mx-auto max-w-3xl px-5 pt-16 sm:px-6">
        <ol className="divide-y divide-[color:var(--hairline)]">
          {STEPS.map((step) => (
            <li key={step.n} className="grid gap-4 py-10 sm:grid-cols-[4rem_1fr]">
              <span className="font-mono text-[13px] text-faint">{step.n}</span>
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight">
                  {step.title}
                </h2>
                <p className="mt-3 text-[15px] leading-[1.65] text-muted">{step.body}</p>
                <p className="mt-3 font-mono text-[11px] tracking-tight text-faint">
                  {step.tag}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-3xl px-5 pt-6 sm:px-6">
        <h2 className="text-[13px] font-semibold tracking-tight">The stack</h2>
        <dl className="mt-4 overflow-hidden rounded-[20px] border border-hairline bg-raised">
          {STACK.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 border-b border-hairline px-5 py-4 last:border-0 sm:grid-cols-[8rem_1fr] sm:gap-4"
            >
              <dt className="text-[13px] font-medium">{label}</dt>
              <dd className="text-[13px] leading-relaxed text-muted">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-[13px] leading-relaxed text-faint">
          No orchestration framework sits in the middle. Chunking, embedding, retrieval
          and prompting are each a few lines of Python, which keeps the serverless bundle
          small and makes every step of the pipeline legible.
        </p>
      </section>
    </>
  );
}

function Pipeline() {
  const nodes = [
    { label: "Microphone", sub: "browser" },
    { label: "Vapi", sub: "speech to text" },
    { label: "This app", sub: "retrieve" },
    { label: "Groq", sub: "generate" },
    { label: "Vapi", sub: "text to speech" },
  ];

  return (
    <div className="rounded-[20px] border border-hairline bg-raised p-6 sm:p-8">
      <ol className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {nodes.map((node, index) => (
          <li key={`${node.label}-${index}`} className="flex flex-1 items-center gap-2">
            <div className="flex-1 rounded-2xl border border-hairline bg-surface px-3 py-3 text-center">
              <p className="text-[13px] font-medium tracking-tight">{node.label}</p>
              <p className="mt-0.5 text-[11px] text-faint">{node.sub}</p>
            </div>
            {index < nodes.length - 1 ? (
              <span aria-hidden className="text-faint">
                <svg viewBox="0 0 16 16" className="size-3.5 rotate-90 sm:rotate-0">
                  <path
                    d="M2 8h11M9 4l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-center text-[12px] text-faint">
        The loop closes back on the microphone — Vapi keeps the call open and handles
        barge-in, so you can interrupt mid-sentence.
      </p>
    </div>
  );
}
