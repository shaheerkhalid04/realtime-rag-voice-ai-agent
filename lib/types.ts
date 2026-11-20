export type Source = {
  id?: string;
  score: number;
  text: string;
  title: string;
  doc_id?: string;
  chunk_index: number;
};

export type TraceSource = {
  title: string;
  score: number;
  chunk_index: number;
  text: string;
};

export type Trace = {
  id: string;
  ts: number;
  question: string;
  retrieval_ms: number;
  sources: TraceSource[];
};

export type DocumentMeta = {
  id: string;
  title: string;
  source: string;
  chunks: number;
  words: number;
  characters: number;
  uploaded_at: number;
  preview: string;
  elapsed_ms?: number;
};

export type Health = {
  ok: boolean;
  missing: string[];
  model: string;
  embed_model: string;
  dimension: number;
  top_k: number;
  documents: number;
  chunks: number;
  secured: boolean;
  /** Vapi's public key, safe to expose - it only authorises starting a call. */
  vapi_public_key: string;
  /** An assistant configured in the Vapi dashboard; when set the page starts it by id. */
  vapi_assistant_id?: string;
  writes_enabled?: boolean;
  latency_ms?: number;
};

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  at: number;
};

export type ChatReply = {
  answer: string;
  sources: Source[];
  timings: { retrieval_ms: number; total_ms: number };
};
