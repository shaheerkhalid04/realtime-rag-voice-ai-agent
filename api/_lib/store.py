"""Vector store operations against Pinecone serverless.

One constraint from Pinecone serverless shapes the ID scheme: serverless indexes
cannot delete by metadata filter, only by ID. So a chunk's ID is prefixed with
its document ID (`{doc_id}#{n}`), which lets a document's vectors be listed by
prefix and deleted exactly. Retrieval traces use the same trick, keyed by the
Vapi call they belong to.
"""

import json
import time
import uuid

from . import config
from .pine import client

_handle = None


# ---------------------------------------------------------------------------
# Index lifecycle
# ---------------------------------------------------------------------------
# Both the existence check and the handle are cached for the lifetime of the
# process. An index cannot stop existing underneath a warm function, and on a
# voice turn every avoidable round trip to Pinecone is dead air in the call.

def index():
    """Return a handle to the index, creating it on first use."""
    global _handle
    if _handle is not None:
        return _handle

    pc = client()
    if not pc.has_index(config.INDEX_NAME):
        from pinecone import ServerlessSpec

        # With no explicit timeout the SDK polls until the index reports ready,
        # which matters because a fresh index rejects writes.
        pc.create_index(
            name=config.INDEX_NAME,
            dimension=config.EMBED_DIMENSION,
            metric="cosine",
            spec=ServerlessSpec(
                cloud=config.PINECONE_CLOUD, region=config.PINECONE_REGION
            ),
        )

    _handle = pc.Index(config.INDEX_NAME)
    return _handle


def index_exists() -> bool:
    if _handle is not None:
        return True
    try:
        return client().has_index(config.INDEX_NAME)
    except Exception:
        return False


def _all_ids(handle, namespace: str, prefix: str | None = None) -> list[str]:
    ids: list[str] = []
    try:
        kwargs = {"namespace": namespace}
        if prefix:
            kwargs["prefix"] = prefix
        for page in handle.list(**kwargs):
            ids.extend(page if isinstance(page, list) else [page])
    except Exception:
        # Namespace does not exist yet, or the SDK surfaced a paging error.
        return []
    return ids


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

def new_document_id() -> str:
    return uuid.uuid4().hex[:16]


def store_document(
    *,
    doc_id: str,
    title: str,
    chunks: list[str],
    chunk_vectors: list[list[float]],
    summary_vector: list[float],
    meta: dict,
) -> None:
    handle = index()

    records = [
        {
            "id": f"{doc_id}#{i}",
            "values": vector,
            "metadata": {
                "doc_id": doc_id,
                "title": title,
                "chunk_index": i,
                "text": text,
            },
        }
        for i, (text, vector) in enumerate(zip(chunks, chunk_vectors))
    ]

    # Batch upserts so a large document does not exceed the request size limit.
    for start in range(0, len(records), 100):
        handle.upsert(vectors=records[start : start + 100], namespace=config.NS_CHUNKS)

    handle.upsert(
        vectors=[{"id": doc_id, "values": summary_vector, "metadata": meta}],
        namespace=config.NS_REGISTRY,
    )


def list_documents() -> list[dict]:
    if not index_exists():
        return []
    handle = index()

    ids = _all_ids(handle, config.NS_REGISTRY)
    if not ids:
        return []

    documents: list[dict] = []
    for start in range(0, len(ids), 100):
        fetched = handle.fetch(ids=ids[start : start + 100], namespace=config.NS_REGISTRY)
        vectors = getattr(fetched, "vectors", None) or {}
        for doc_id, record in vectors.items():
            meta = dict(getattr(record, "metadata", None) or {})
            meta["id"] = doc_id
            documents.append(meta)

    documents.sort(key=lambda d: d.get("uploaded_at", 0), reverse=True)
    return documents


def delete_document(doc_id: str) -> int:
    """Remove a document's registry entry and every chunk vector it produced."""
    handle = index()

    chunk_ids = _all_ids(handle, config.NS_CHUNKS, prefix=f"{doc_id}#")
    for start in range(0, len(chunk_ids), 500):
        handle.delete(ids=chunk_ids[start : start + 500], namespace=config.NS_CHUNKS)

    handle.delete(ids=[doc_id], namespace=config.NS_REGISTRY)
    return len(chunk_ids)


def count_chunks() -> int:
    if not index_exists():
        return 0
    try:
        stats = index().describe_index_stats()
        namespaces = getattr(stats, "namespaces", None) or {}
        chunks = namespaces.get(config.NS_CHUNKS)
        if chunks is None:
            return 0
        return int(getattr(chunks, "vector_count", 0) or 0)
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------

def search(vector: list[float], top_k: int) -> list[dict]:
    if not index_exists():
        return []
    response = index().query(
        vector=vector,
        top_k=top_k,
        include_metadata=True,
        namespace=config.NS_CHUNKS,
    )
    matches = getattr(response, "matches", None) or []

    results = []
    for match in matches:
        meta = dict(getattr(match, "metadata", None) or {})
        results.append(
            {
                "id": getattr(match, "id", ""),
                "score": float(getattr(match, "score", 0.0) or 0.0),
                "text": meta.get("text", ""),
                "title": meta.get("title", "unknown"),
                "doc_id": meta.get("doc_id", ""),
                "chunk_index": int(meta.get("chunk_index", 0) or 0),
            }
        )
    return results


# ---------------------------------------------------------------------------
# Retrieval traces
# ---------------------------------------------------------------------------
# A voice turn never passes through the browser - Vapi calls the backend
# directly - so the sources panel would otherwise have nothing to show. Each
# turn writes a trace the client polls for. Reusing the query embedding as the
# vector makes the write free: it is already computed, and it makes past turns
# semantically searchable as a side effect.

def write_trace(call_id: str, vector: list[float], payload: dict) -> str:
    trace_id = f"{call_id}#{int(time.time() * 1000)}"
    body = json.dumps(payload)[:38000]  # Pinecone caps metadata at 40 KB/record
    try:
        index().upsert(
            vectors=[{"id": trace_id, "values": vector, "metadata": {"payload": body}}],
            namespace=config.NS_TRACES,
        )
    except Exception:
        # A trace is a UI nicety. Never let it break a live call.
        return ""
    return trace_id


def read_traces(call_id: str, limit: int = 40) -> list[dict]:
    if not index_exists():
        return []
    handle = index()

    ids = _all_ids(handle, config.NS_TRACES, prefix=f"{call_id}#")
    if not ids:
        return []
    # The suffix is a millisecond timestamp, so this puts newest first.
    ids.sort(reverse=True)
    ids = ids[:limit]

    traces: list[dict] = []
    fetched = handle.fetch(ids=ids, namespace=config.NS_TRACES)
    vectors = getattr(fetched, "vectors", None) or {}
    for trace_id, record in vectors.items():
        meta = dict(getattr(record, "metadata", None) or {})
        try:
            payload = json.loads(meta.get("payload", "{}"))
        except json.JSONDecodeError:
            continue
        payload["id"] = trace_id
        traces.append(payload)

    traces.sort(key=lambda entry: entry.get("ts", 0))
    return traces


def clear_traces(call_id: str) -> int:
    if not index_exists():
        return 0
    handle = index()
    ids = _all_ids(handle, config.NS_TRACES, prefix=f"{call_id}#")
    for start in range(0, len(ids), 500):
        handle.delete(ids=ids[start : start + 500], namespace=config.NS_TRACES)
    return len(ids)
