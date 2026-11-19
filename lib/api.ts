import type { ChatReply, DocumentMeta, Health, Trace } from "./types";

const BASE = "/api/py";

// Knowledge-base writes need the admin token. It lives only in this browser, entered on the
// Knowledge page, and is sent as a header; it is never part of the bundle.
const ADMIN_KEY = "attune-admin-token";

export function getAdminToken(): string {
  try {
    return window.localStorage.getItem(ADMIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(value: string): void {
  try {
    if (value) window.localStorage.setItem(ADMIN_KEY, value);
    else window.localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* private mode: the token just will not persist */
  }
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { "x-admin-token": token } : {};
}

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
  return request<DocumentMeta>("/documents", { method: "POST", body: form, headers: adminHeaders() });
}

export function addText(title: string, text: string) {
  const form = new FormData();
  form.append("title", title);
  form.append("text", text);
  return request<DocumentMeta>("/documents/text", { method: "POST", body: form, headers: adminHeaders() });
}

export const deleteDocument = (id: string) =>
  request<{ deleted: string; chunks: number }>(`/documents/${id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });

export const sendChat = (messages: { role: string; content: string }[]) =>
  request<ChatReply>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

export const getTraces = (callId: string) =>
  request<{ traces: Trace[] }>(`/traces/${encodeURIComponent(callId)}`);
