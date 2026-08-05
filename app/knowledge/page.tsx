"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Chip, Notice, Panel, Spinner } from "@/components/ui";
import { addText, deleteDocument, getDocuments, uploadDocument } from "@/lib/api";
import type { DocumentMeta } from "@/lib/types";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [chunks, setChunks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  // Pinecone serverless is eventually consistent: a vector that was just written
  // is not listable for a second or two, and one that was just deleted keeps
  // coming back for about as long. Without these two hold sets the list would
  // visibly disagree with the action the user just took. Entries leave a set the
  // moment the server's own answer agrees, and the effect keeps re-polling until
  // both are empty.
  const [added, setAdded] = useState<DocumentMeta[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  // The list is reloaded by bumping a token rather than by calling a fetcher
  // directly, so the request lives inside the effect and can be abandoned if the
  // page unmounts or another reload lands first.
  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    getDocuments()
      .then((data) => {
        if (cancelled) return;
        setDocuments(data.documents);
        setChunks(data.chunks);

        const known = new Set(data.documents.map((document) => document.id));
        const stillMissing = added.filter((document) => !known.has(document.id));
        const stillPresent = removed.filter((id) => known.has(id));
        setAdded(stillMissing);
        setRemoved(stillPresent);

        if (stillMissing.length || stillPresent.length) {
          retry = setTimeout(() => setReloads((count) => count + 1), 1500);
        }
      })
      .catch((exception: unknown) => {
        if (cancelled) return;
        setError(exception instanceof Error ? exception.message : "Could not load.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
    // `added` and `removed` are read, not tracked: reacting to them would loop,
    // and the retry timer is what drives convergence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloads]);

  const visible = useMemo(
    () => [...added, ...documents.filter((document) => !removed.includes(document.id))],
    [added, documents, removed],
  );

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      for (const file of Array.from(files)) {
        setBusy(`Indexing ${file.name}`);
        try {
          const document = await uploadDocument(file);
          setAdded((previous) => [document, ...previous]);
        } catch (exception) {
          setError(
            exception instanceof Error ? exception.message : `${file.name} failed.`,
          );
          break;
        }
      }
      setBusy(null);
      refresh();
    },
    [refresh],
  );

  const paste = useCallback(async () => {
    setError(null);
    setBusy("Indexing note");
    try {
      const document = await addText(title.trim() || "Pasted note", body);
      setAdded((previous) => [document, ...previous]);
      setTitle("");
      setBody("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "That note failed.");
    } finally {
      setBusy(null);
      refresh();
    }
  }, [body, refresh, title]);

  const remove = useCallback(
    async (document: DocumentMeta) => {
      setBusy(`Removing ${document.title}`);
      try {
        await deleteDocument(document.id);
        setAdded((previous) => previous.filter((entry) => entry.id !== document.id));
        setRemoved((previous) => [...previous, document.id]);
      } catch (exception) {
        setError(exception instanceof Error ? exception.message : "Delete failed.");
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [refresh],
  );

  return (
    <>
      <section className="mx-auto max-w-5xl px-5 pt-16 pb-10 text-center sm:px-6 sm:pt-20">
        <p className="eyebrow rise">Knowledge base</p>
        <h1 className="headline rise mt-4 text-[clamp(2.25rem,1.5rem+3.4vw,3.75rem)]">
          Everything it knows.
        </h1>
        <p className="subhead rise mx-auto mt-5 max-w-[48ch]">
          Add a document and it is split, embedded and indexed in seconds. Remove one and
          the assistant forgets it just as quickly.
        </p>
        <p className="mt-5 text-[12px] text-faint">
          {visible.length} document{visible.length === 1 ? "" : "s"} ·{" "}
          {chunks.toLocaleString()} passages indexed
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-5 sm:px-6">
        <div className="mb-4 flex items-center justify-center gap-1 rounded-full border border-hairline bg-surface p-1">
          {(["file", "text"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex-1 rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-200 ${
                mode === value ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {value === "file" ? "Upload a file" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length) ingest(event.dataTransfer.files);
            }}
            className={`rounded-[20px] border-2 border-dashed p-10 text-center transition-colors duration-200 ${
              dragging ? "border-accent bg-accent/6" : "border-hairline bg-raised"
            }`}
          >
            <p className="text-[17px] font-medium tracking-tight">
              Drop a PDF, Word file, or note here
            </p>
            <p className="mt-1.5 text-[13px] text-muted">
              PDF, DOCX, TXT or MD, up to 4 MB each.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) ingest(event.target.files);
                event.target.value = "";
              }}
            />
            <Button
              className="mt-5"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
            >
              Choose a file
            </Button>
          </div>
        ) : (
          <Panel>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              className="w-full rounded-xl border border-hairline bg-surface px-4 py-2.5 text-[15px]
                placeholder:text-faint focus:outline-none focus-visible:border-accent"
            />
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Paste anything the assistant should be able to answer from…"
              rows={8}
              className="scroller mt-3 w-full resize-y rounded-xl border border-hairline bg-surface px-4 py-3
                text-[15px] leading-relaxed placeholder:text-faint focus:outline-none
                focus-visible:border-accent"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12px] text-faint">
                {body.trim().length.toLocaleString()} characters
              </span>
              <Button onClick={paste} disabled={body.trim().length < 40 || !!busy}>
                Add to knowledge base
              </Button>
            </div>
          </Panel>
        )}

        <div className="mt-4 space-y-3">
          {busy ? (
            <p className="flex items-center justify-center gap-2 text-[13px] text-muted">
              <Spinner /> {busy}…
            </p>
          ) : null}
          {error ? <Notice title="That didn’t work">{error}</Notice> : null}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 pt-12 sm:px-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Indexed documents</h2>

        {loading ? (
          <p className="mt-6 flex items-center gap-2 text-[14px] text-muted">
            <Spinner /> Loading…
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-6 text-[14px] text-faint">
            Nothing indexed yet. The assistant will say so rather than guess.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[color:var(--hairline)] overflow-hidden rounded-[20px] border border-hairline bg-raised">
            {visible.map((document) => (
              <li key={document.id} className="flex items-start gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[15px] font-medium tracking-tight">
                      {document.title}
                    </h3>
                    <Chip>{document.chunks} passages</Chip>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
                    {document.preview}
                  </p>
                  <p className="mt-2 text-[11px] text-faint">
                    {document.words.toLocaleString()} words ·{" "}
                    {new Date(document.uploaded_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(document)}
                  disabled={!!busy}
                  aria-label={`Remove ${document.title}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
