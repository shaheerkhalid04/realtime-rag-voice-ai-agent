"""Write lockdown and the verified health check, with Pinecone and Groq faked.
    pip install -r requirements.txt pytest httpx && python -m pytest tests
"""

import importlib
import sys

from fastapi.testclient import TestClient


def load(monkeypatch, admin_token=""):
    monkeypatch.setenv("ADMIN_TOKEN", admin_token)
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setenv("PINECONE_API_KEY", "test")
    for name in [m for m in sys.modules if m.startswith("api")]:
        del sys.modules[name]
    index = importlib.import_module("api.index")
    monkeypatch.setattr(index.store, "list_documents", lambda: [])
    monkeypatch.setattr(index.store, "count_chunks", lambda: 0)
    return index, TestClient(index.app)


def test_writes_are_off_without_an_admin_token(monkeypatch):
    _, client = load(monkeypatch)
    assert client.post("/api/py/documents", files={"file": ("a.txt", b"hello")}).status_code == 503
    assert client.post("/api/py/documents/text", data={"title": "t", "text": "x" * 50}).status_code == 503
    assert client.delete("/api/py/documents/abc").status_code == 503
    assert client.delete("/api/py/traces/call-123").status_code == 503


def test_writes_need_the_right_token(monkeypatch):
    _, client = load(monkeypatch, admin_token="s3cret")
    assert client.delete("/api/py/documents/abc").status_code == 401
    assert client.delete("/api/py/documents/abc", headers={"x-admin-token": "nope"}).status_code == 401


def test_verify_reports_the_model_call(monkeypatch):
    index, client = load(monkeypatch)

    def boom():
        raise RuntimeError("Error code: 404 - model_not_found")

    monkeypatch.setattr(index.rag, "verify", boom)
    body = client.get("/api/py/health?verify=1").json()
    assert body["ok"] is False and "latency_ms" not in body

    monkeypatch.setattr(index.rag, "verify", lambda: {"ok": True, "model": "m", "latency_ms": 9.0})
    body = client.get("/api/py/health?verify=1").json()
    assert body["ok"] is True and body["latency_ms"] == 9.0 and body["model"] == index.config.CHAT_MODEL


def test_reads_stay_open(monkeypatch):
    _, client = load(monkeypatch, admin_token="s3cret")
    assert client.get("/api/py/documents").status_code == 200
