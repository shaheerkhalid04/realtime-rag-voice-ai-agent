import type { ChatReply, DocumentMeta, Health, Trace } from "./types";

const BASE = "/api/py";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    // FastAPI puts the human-readable reason in `detail`; anything else means
    // the function itself fell over and the status is all we have.
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* keep the status-code message */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export const getHealth = () => request<Health>("/health");

export const getDocuments = () =>
  request<{ documents: DocumentMeta[]; chunks: number }>("/documents");

export function uploadDocument(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<DocumentMeta>("/documents", { method: "POST", body: form });
}

export function addText(title: string, text: string) {
  const form = new FormData();
  form.append("title", title);
  form.append("text", text);
  return request<DocumentMeta>("/documents/text", { method: "POST", body: form });
}

export const deleteDocument = (id: string) =>
  request<{ deleted: string; chunks: number }>(`/documents/${id}`, {
    method: "DELETE",
  });

export const sendChat = (messages: { role: string; content: string }[]) =>
  request<ChatReply>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

export const getTraces = (callId: string) =>
  request<{ traces: Trace[] }>(`/traces/${encodeURIComponent(callId)}`);
