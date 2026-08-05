# Attune — a real-time RAG voice assistant

Ask a question out loud and hear an answer your own documents actually support.

Attune wires [Vapi](https://vapi.ai) to a retrieval pipeline: Vapi handles the call, the
microphone, speech-to-text, turn-taking and speech synthesis, while every answer it
speaks is written from passages retrieved out of a private knowledge base. If the
documents cannot answer the question, it says so instead of improvising.

```
microphone ─▶ Vapi (STT) ─▶ this app ─▶ Pinecone ─▶ Groq ─▶ this app ─▶ Vapi (TTS) ─▶ speaker
                                        retrieve    generate    stream
```

---

## The integration in one line

Vapi's assistant is configured with a **custom language model**:

```ts
model: {
  provider: "custom-llm",
  url: `${origin}/api/py`,
}
```

That single substitution is the whole thing. Instead of calling a hosted model, Vapi
POSTs an OpenAI-shaped chat-completions request to this app for every turn of the call.
The backend embeds the question, searches the vector index, injects the retrieved
passages as the model's entire world, and streams the answer back as
`text/event-stream` chunks. Vapi begins synthesising speech from the first chunk, so the
reply starts playing before it has finished being written.

Because retrieval sits *inside* the model call rather than beside it, there is no path
by which the assistant can answer without it.

## Features

- **Real-time spoken conversation** with barge-in — interrupt mid-sentence and it stops.
- **Grounded answers only.** Matches below a similarity floor are discarded, and an
  empty result produces an honest "I don't have that" rather than a guess.
- **Live evidence.** The passages behind each spoken answer appear beside the transcript,
  with similarity scores, while the answer is still being said.
- **A voice-shaped prompt.** Two or three sentences, no markdown, no bracketed citations,
  figures expanded into words — everything produced here is read aloud by a machine.
- **Conversational follow-ups.** "And how much does that cost?" is stitched to the
  previous turn before it is embedded, so short dependent questions still retrieve.
- **Social turns skip retrieval.** "Hey there" and "thanks, that was great" are answered
  directly rather than sent through a vector search.
- **A typed fallback** that runs the identical pipeline, so the app is fully usable and
  demonstrable without a microphone.
- **Document management** — drag in a PDF, DOCX, TXT or MD file, or paste text; remove it
  and the assistant forgets it.

## Stack

| Layer | Choice |
| --- | --- |
| Voice | Vapi — WebRTC transport, Deepgram STT, Vapi TTS, turn-taking |
| Vectors + embeddings | Pinecone serverless with hosted `llama-text-embed-v2` |
| Generation | Groq, `llama-3.3-70b-versatile`, streamed |
| Backend | FastAPI, deployed as one Python serverless function |
| Frontend | Next.js App Router, React 19, Tailwind v4 |

There is no orchestration framework. Chunking, embedding, retrieval and prompting are
each a few dozen lines of Python — which keeps the serverless bundle far under its
250 MB ceiling and keeps every step of the pipeline readable.

---

## Running it

### 1. Keys

```bash
cp .env.example .env.local
```

| Variable | Where it comes from |
| --- | --- |
| `PINECONE_API_KEY` | [app.pinecone.io](https://app.pinecone.io) → API Keys |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) |
| `VAPI_PUBLIC_KEY` | [dashboard.vapi.ai](https://dashboard.vapi.ai) → API Keys → **Public** key |
| `NEXT_PUBLIC_RAG_LLM_ORIGIN` | The public HTTPS origin Vapi should call (see below) |

Vapi's public key is deliberately *not* a `NEXT_PUBLIC_` build-time variable. The backend
reads it and hands it to the page through `/api/py/health`, so rotating the key takes
effect without a rebuild. A build-time `NEXT_PUBLIC_VAPI_PUBLIC_KEY` still works and wins
if both are set.

All four have a free tier. The Pinecone index is created on first use — nothing to set
up in either dashboard.

### 2. Install

```bash
npm install
```

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt uvicorn
```

(On macOS or Linux that second path is `.venv/bin/pip`.)

### 3. Run

```bash
npm run dev
```

That starts Next.js on `:3000` and uvicorn on `:8000` together; `next.config.ts` proxies
`/api/py/*` to the Python process in development and to the serverless function in
production, so the same routes work in both.

Open `http://localhost:3000`, add a document on **Knowledge**, and ask something.

### The one thing that trips people up

Vapi calls the custom language model **from its own servers**, not from the browser. It
therefore cannot reach `http://localhost:3000`. Typed questions work locally regardless,
but for spoken calls set `NEXT_PUBLIC_RAG_LLM_ORIGIN` to something publicly reachable:

- the deployed URL (simplest — run the UI locally against the deployed backend), or
- a tunnel: `ngrok http 3000`, then use the `https://` URL it prints.

The app detects a `localhost` origin and tells you this before starting a call rather
than failing mid-connection.

---

## Deploying

```bash
vercel --prod
```

Set `PINECONE_API_KEY`, `GROQ_API_KEY` and `VAPI_PUBLIC_KEY` in the project's environment
variables. `NEXT_PUBLIC_RAG_LLM_ORIGIN` can be left unset in production — the page falls
back to its own origin, which is already publicly reachable. `vercel.json` gives the
Python function a 60-second ceiling and bundles `api/_lib`.

Deploying close to your Pinecone region matters more than it looks: retrieval is on the
critical path of a live conversation, and the same query that takes ~700 ms from a
laptop in another continent takes a fraction of that from `us-east-1`.

### Optional: lock the endpoint

Set `VAPI_SERVER_SECRET` on the deployment *and* in the Vapi assistant's custom-LLM
headers. Every request without a matching `x-vapi-secret` header is then rejected.

---

## API

All routes are prefixed `/api/py`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Credential status, model names, index size |
| `GET` | `/documents` | List indexed documents |
| `POST` | `/documents` | Upload a file (multipart, ≤ 4 MB) |
| `POST` | `/documents/text` | Index pasted text |
| `DELETE` | `/documents/{id}` | Remove a document and all its vectors |
| `POST` | `/search` | Raw retrieval, for inspection |
| `POST` | `/chat` | Text answer with sources and timings |
| `POST` | `/chat/completions` | **The Vapi endpoint.** OpenAI-compatible, SSE |
| `GET` | `/traces/{call_id}` | What was retrieved during a call |

The custom-LLM endpoint is a real OpenAI-compatible surface, so it can be exercised with
plain `curl`:

```bash
curl -N -X POST http://127.0.0.1:8000/api/py/chat/completions -H "Content-Type: application/json" -d '{"stream":true,"messages":[{"role":"user","content":"What does the warranty exclude?"}]}'
```

`/chat/completions` is also accepted at `/vapi/chat/completions`, so the assistant URL
can be configured as either `<origin>/api/py` or `<origin>/api/py/vapi`.

---

## Notes from building it

- **Pinecone serverless cannot delete by metadata filter**, only by ID. Chunk IDs are
  therefore `{doc_id}#{n}`, which makes a document's vectors listable by prefix and
  deletable exactly.
- **It is also eventually consistent.** A document that was just indexed is not listable
  for a second or two, and one that was just deleted keeps coming back for about as long.
  The Knowledge page holds optimistic entries until the server's own answer agrees.
- **Cache the index handle.** An uncached existence check added two network round trips
  to every query; removing them took warm retrieval from ~2.9 s to ~0.7 s. On a voice
  call that difference is audible as dead air.
- **A voice turn never passes through the browser**, so the sources panel cannot observe
  retrieval directly. The backend writes a trace keyed by Vapi's call ID — using the
  query embedding it already computed, so the write costs nothing — and the client polls
  it during the call.
- **Follow-ups need help.** "How long should I let it cool?" retrieves almost nothing on
  its own. An LLM query rewrite would be the thorough fix but adds a round trip mid-call;
  stitching the previous user turn onto an obviously dependent one is free and recovers
  most of the benefit.
