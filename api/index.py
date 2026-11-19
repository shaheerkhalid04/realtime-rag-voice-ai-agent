"""FastAPI backend for the real-time RAG voice assistant.

Two consumers, one pipeline:

  * The browser calls /api/py/documents, /api/py/search and /api/py/chat.
  * Vapi's servers call /api/py/chat/completions, an OpenAI-compatible endpoint
    that Vapi treats as the assistant's language model. Every request that
    arrives there is retrieved against the knowledge base first, so the voice the
    caller hears can only say what the documents support.

Routes carry their full /api/py prefix because Vercel preserves the original
request path when it routes into a Python function, and next.config.ts proxies
the same prefix to uvicorn in development.
"""

import hmac
import json
import time
import uuid

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from ._lib import chunking, config, embeddings, extract, rag, store

app = FastAPI(title="Real-Time RAG Voice Assistant", docs_url=None, redoc_url=None)


def _fail(status: int, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail=message)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Knowledge-base writes need the admin token. Without ADMIN_TOKEN configured, writes are off."""
    if not config.ADMIN_TOKEN:
        raise _fail(503, "Writes are disabled: ADMIN_TOKEN is not configured on this deployment.")
    if not x_admin_token or not hmac.compare_digest(x_admin_token, config.ADMIN_TOKEN):
        raise _fail(401, "This action needs the admin token.")


@app.get("/api/py/health")
def health(verify: bool = Query(False)):
    """Status for the page. With ?verify=1 it also makes a real, tiny model call and reports
    ok, model and latency_ms, so a retired model shows up as not ok."""
    missing = config.missing_credentials()
    documents = [] if missing else store.list_documents()
    payload = {
        "ok": not missing,
        "missing": missing,
        "model": config.CHAT_MODEL,
        "embed_model": config.EMBED_MODEL,
        "dimension": config.EMBED_DIMENSION,
        "top_k": config.TOP_K,
        "documents": len(documents),
        "chunks": 0 if missing else store.count_chunks(),
        "secured": bool(config.VAPI_SERVER_SECRET),
        "vapi_public_key": config.VAPI_PUBLIC_KEY,
        "vapi_assistant_id": config.VAPI_ASSISTANT_ID,
        "writes_enabled": bool(config.ADMIN_TOKEN),
    }
    if verify and not missing:
        try:
            payload["latency_ms"] = rag.verify()["latency_ms"]
        except Exception as exc:  # noqa: BLE001
            payload["ok"] = False
            payload["verify_error"] = type(exc).__name__
            payload["detail"] = str(exc)[:300]
    elif verify:
        payload["ok"] = False
    return payload


# ---------------------------------------------------------------------------
# Knowledge base
# ---------------------------------------------------------------------------

def _ingest(title: str, text: str, source: str) -> dict:
    started = time.perf_counter()

    chunks = chunking.split_text(text, config.CHUNK_SIZE, config.CHUNK_OVERLAP)
    if not chunks:
        raise _fail(400, "There was no usable text in that document.")

    vectors = embeddings.embed_documents(chunks)
    doc_id = store.new_document_id()
    meta = {
        "title": title,
        "source": source,
        "chunks": len(chunks),
        "words": chunking.word_count(text),
        "characters": len(text),
        "uploaded_at": int(time.time() * 1000),
        "preview": text[:280],
    }

    store.store_document(
        doc_id=doc_id,
        title=title,
        chunks=chunks,
        chunk_vectors=vectors,
        # The registry entry needs a vector of the right width; the first chunk
        # stands in for the document and keeps the entry semantically useful.
        summary_vector=vectors[0],
        meta=meta,
    )

    meta["id"] = doc_id
    meta["elapsed_ms"] = int((time.perf_counter() - started) * 1000)
    return meta


@app.get("/api/py/documents")
def documents():
    if config.missing_credentials():
        return {"documents": [], "chunks": 0}
    return {"documents": store.list_documents(), "chunks": store.count_chunks()}


@app.post("/api/py/documents", dependencies=[Depends(require_admin)])
async def upload_document(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise _fail(400, "That file is empty.")
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise _fail(
            413,
            f"Files are limited to {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB. "
            "Split the document and upload it in parts.",
        )

    name = file.filename or "document"
    try:
        text = extract.extract_text(name, data)
    except (extract.UnsupportedFile, extract.EmptyDocument) as exc:
        raise _fail(400, str(exc))

    return _ingest(name, text, "upload")


@app.post("/api/py/documents/text", dependencies=[Depends(require_admin)])
async def add_text(title: str = Form(...), text: str = Form(...)):
    cleaned = text.strip()
    if len(cleaned) < 40:
        raise _fail(400, "Paste at least a couple of sentences.")
    return _ingest(title.strip() or "Pasted note", cleaned, "text")


@app.delete("/api/py/documents/{doc_id}", dependencies=[Depends(require_admin)])
def remove_document(doc_id: str):
    return {"deleted": doc_id, "chunks": store.delete_document(doc_id)}


# ---------------------------------------------------------------------------
# Retrieval and text chat
# ---------------------------------------------------------------------------

@app.post("/api/py/search")
async def search(request: Request):
    body = await request.json()
    query = str(body.get("query") or "").strip()
    if not query:
        raise _fail(400, "A query is required.")

    matches, elapsed_ms = rag.retrieve(query, int(body.get("top_k") or config.TOP_K))
    return {"query": query, "matches": matches, "elapsed_ms": elapsed_ms}


@app.post("/api/py/chat")
async def chat(request: Request):
    """The typed equivalent of a voice turn, used by the transcript composer."""
    body = await request.json()
    messages = body.get("messages") or []
    question = str(body.get("message") or "").strip()
    if question:
        messages = list(messages) + [{"role": "user", "content": question}]
    if not messages:
        raise _fail(400, "A message is required.")

    question = str(messages[-1].get("content") or "").strip()
    started = time.perf_counter()
    matches, retrieval_ms = rag.retrieve(rag.retrieval_query(messages))

    if not matches:
        text = (
            "Nothing in the knowledge base covers that. Add a document that does, "
            "then ask again."
        )
    else:
        text = rag.answer(question, matches, voice=False, history=messages[:-1])

    return {
        "answer": text,
        "sources": matches,
        "timings": {
            "retrieval_ms": retrieval_ms,
            "total_ms": int((time.perf_counter() - started) * 1000),
        },
    }


# ---------------------------------------------------------------------------
# Vapi custom language model
# ---------------------------------------------------------------------------
# Vapi is configured with `model.provider = "custom-llm"` pointing at this app.
# It then POSTs an OpenAI chat-completions payload here for every turn of the
# call and speaks whatever comes back. Retrieval happens in between, which is
# what makes the spoken answer grounded rather than improvised.

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _chunk(completion_id: str, created: int, delta: dict, finish: str | None) -> dict:
    return {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": config.CHAT_MODEL,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


def _authorise(request: Request) -> None:
    if not config.VAPI_SERVER_SECRET:
        return
    if request.headers.get("x-vapi-secret") != config.VAPI_SERVER_SECRET:
        raise _fail(401, "Invalid or missing x-vapi-secret header.")


def _call_id(body: dict) -> str:
    call = body.get("call")
    if isinstance(call, dict) and call.get("id"):
        return str(call["id"])
    return "web"


async def _completions(request: Request):
    _authorise(request)
    if config.missing_credentials():
        raise _fail(503, f"Server is missing {', '.join(config.missing_credentials())}.")

    body = await request.json()
    messages = [m for m in (body.get("messages") or []) if isinstance(m, dict)]
    user_turns = [m for m in messages if m.get("role") == "user" and m.get("content")]
    question = str(user_turns[-1]["content"]).strip() if user_turns else ""

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    created = int(time.time())
    started = time.perf_counter()

    # Greetings and thank-yous do not deserve a vector search in the middle of a
    # live call - answering them straight keeps the conversation feeling human.
    if not question or rag.is_small_talk(question):
        matches: list[dict] = []
        vector: list[float] | None = None
        retrieval_ms = 0
        social = True
    else:
        social = False
        matches, vector, retrieval_ms = rag.retrieve_with_vector(
            rag.retrieval_query(messages)
        )
        store.write_trace(
            _call_id(body),
            vector,
            {
                "ts": int(time.time() * 1000),
                "question": question,
                "retrieval_ms": retrieval_ms,
                "sources": [
                    {
                        "title": m["title"],
                        "score": round(m["score"], 4),
                        "chunk_index": m["chunk_index"],
                        "text": m["text"][:600],
                    }
                    for m in matches
                ],
            },
        )

    def fixed(text: str):
        """Stream a canned line through the same protocol Vapi expects."""
        yield _sse(_chunk(completion_id, created, {"role": "assistant"}, None))
        yield _sse(_chunk(completion_id, created, {"content": text}, None))
        yield _sse(_chunk(completion_id, created, {}, "stop"))
        yield "data: [DONE]\n\n"

    if not social and not matches:
        empty = store.count_chunks() == 0
        line = rag.NO_DOCUMENTS_VOICE if empty else rag.NO_CONTEXT_VOICE
        if not body.get("stream", True):
            return JSONResponse(_completion_body(completion_id, created, line))
        return StreamingResponse(fixed(line), media_type="text/event-stream")

    history = [m for m in messages if m.get("role") in ("user", "assistant")][:-1]

    if not body.get("stream", True):
        text = (
            rag.answer(question, matches, voice=True, history=history)
            if not social
            else _social_reply(question, history)
        )
        return JSONResponse(_completion_body(completion_id, created, text))

    def generate():
        yield _sse(_chunk(completion_id, created, {"role": "assistant"}, None))
        try:
            if social:
                yield _sse(
                    _chunk(completion_id, created, {"content": _social_reply(question, history)}, None)
                )
            else:
                for piece in rag.stream_answer(
                    question, matches, voice=True, history=history
                ):
                    yield _sse(_chunk(completion_id, created, {"content": piece}, None))
        except Exception as exc:  # noqa: BLE001 - the caller is a phone line, not a console
            yield _sse(
                _chunk(
                    completion_id,
                    created,
                    {"content": f"Sorry, something went wrong on my side. {exc}"},
                    None,
                )
            )
        yield _sse(_chunk(completion_id, created, {}, "stop"))
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Retrieval-Ms": str(retrieval_ms),
            "X-Prompt-Ms": str(int((time.perf_counter() - started) * 1000)),
        },
    )


def _social_reply(question: str, history: list[dict]) -> str:
    """One short, sourceless line for a purely social turn."""
    return rag.client().chat.completions.create(
        model=config.CHAT_MODEL,
        temperature=0.4,
        max_tokens=60,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a warm, brief voice assistant for a private knowledge base. "
                    "Reply to this social remark in one short spoken sentence. "
                    "No markdown, no lists, no emoji. If it fits, invite a question about "
                    "the documents."
                ),
            },
            *[
                {"role": m["role"], "content": str(m.get("content") or "")}
                for m in history[-4:]
            ],
            {"role": "user", "content": question or "Hello"},
        ],
    ).choices[0].message.content.strip()


def _completion_body(completion_id: str, created: int, text: str) -> dict:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": config.CHAT_MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
    }


# Vapi appends /chat/completions to whatever base URL it is given. Both spellings
# are accepted so the URL can be configured as either <origin>/api/py or
# <origin>/api/py/vapi without a surprise 404 mid-call.
@app.post("/api/py/chat/completions")
async def vapi_completions(request: Request):
    return await _completions(request)


@app.post("/api/py/vapi/chat/completions")
async def vapi_completions_alias(request: Request):
    return await _completions(request)


# ---------------------------------------------------------------------------
# Retrieval traces
# ---------------------------------------------------------------------------
# A voice turn never touches the browser, so this is how the sources panel knows
# what the assistant just read.

@app.get("/api/py/traces/{call_id}")
def traces(call_id: str):
    if config.missing_credentials():
        return {"traces": []}
    return {"traces": store.read_traces(call_id)}


@app.delete("/api/py/traces/{call_id}", dependencies=[Depends(require_admin)])
def clear_traces(call_id: str):
    return {"cleared": store.clear_traces(call_id)}
