"""Central configuration, read once from the environment."""

import os

# Next.js reads .env.local on its own; uvicorn does not. Load it here so the
# documented local workflow works with one command. On Vercel this finds nothing
# and the platform's environment variables are used unchanged.
try:
    from dotenv import load_dotenv

    _ROOT = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    for _name in (".env.local", ".env"):
        load_dotenv(os.path.join(_ROOT, _name), override=False)
except ImportError:
    pass

# --- Credentials -----------------------------------------------------------
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY", "").strip()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()

# Optional shared secret. When set, Vapi must echo it back on every custom-LLM
# request as the x-vapi-secret header.
VAPI_SERVER_SECRET = os.environ.get("VAPI_SERVER_SECRET", "").strip()
# Optional: an assistant configured in the Vapi dashboard (custom LLM URL plus the
# x-vapi-secret header). When set, the page starts that assistant instead of building one
# in the browser, which is what lets VAPI_SERVER_SECRET be switched on safely.
VAPI_ASSISTANT_ID = os.environ.get("VAPI_ASSISTANT_ID", "").strip()
# Required for every knowledge-base write and for clearing traces. Unset means writes are off.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()

# Vapi's *public* key, which is meant to be visible to the browser - it only
# authorises starting a web call. Serving it from /health rather than baking it
# in as a NEXT_PUBLIC_ variable means rotating the key does not need a rebuild.
# The NEXT_PUBLIC_ spelling is still honoured so an existing build-time value
# keeps working.
VAPI_PUBLIC_KEY = (
    os.environ.get("VAPI_PUBLIC_KEY")
    or os.environ.get("NEXT_PUBLIC_VAPI_PUBLIC_KEY")
    or ""
).strip()

# --- Embeddings ------------------------------------------------------------
# Pinecone hosts the embedding model, so no separate embedding provider or key
# is needed and nothing has to be downloaded into the serverless bundle.
EMBED_MODEL = os.environ.get("EMBED_MODEL", "llama-text-embed-v2")
EMBED_DIMENSION = int(os.environ.get("EMBED_DIMENSION", "1024"))
EMBED_BATCH = 96  # Pinecone inference caps a single embed call at 96 inputs

# --- Vector store ----------------------------------------------------------
INDEX_NAME = os.environ.get("PINECONE_INDEX", "voice-rag")
PINECONE_CLOUD = os.environ.get("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.environ.get("PINECONE_REGION", "us-east-1")

NS_CHUNKS = "chunks"
NS_REGISTRY = "registry"
NS_TRACES = "traces"

# --- Retrieval and generation ---------------------------------------------
CHAT_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
TOP_K = int(os.environ.get("TOP_K", "5"))
# Below this cosine score a match is noise rather than context. Spoken questions
# are short and full of filler, so the floor is deliberately forgiving.
MIN_SCORE = float(os.environ.get("MIN_SCORE", "0.18"))

# --- Ingestion limits ------------------------------------------------------
# Vercel serverless functions reject request bodies above ~4.5 MB.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "150"))

SUPPORTED_EXTENSIONS = (".pdf", ".docx", ".txt", ".md", ".markdown")


def missing_credentials() -> list[str]:
    missing = []
    if not PINECONE_API_KEY:
        missing.append("PINECONE_API_KEY")
    if not GROQ_API_KEY:
        missing.append("GROQ_API_KEY")
    return missing
