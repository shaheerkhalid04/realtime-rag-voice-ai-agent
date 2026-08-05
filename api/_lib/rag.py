"""Retrieval and grounded generation.

Everything voice-specific lives here rather than in the transport layer, because
the same pipeline serves both the Vapi custom-LLM endpoint and the text chat in
the browser - only the system prompt and the shape of the output differ.
"""

import re
import time
from collections.abc import Iterator

from . import config, embeddings, store

_client = None


class MissingCredentials(Exception):
    pass


def client():
    global _client
    if _client is None:
        if not config.GROQ_API_KEY:
            raise MissingCredentials(
                "GROQ_API_KEY is not set. Add it to .env.local or your Vercel project."
            )
        from groq import Groq

        _client = Groq(api_key=config.GROQ_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

VOICE_SYSTEM = """You are a voice assistant answering out loud from a private knowledge base.

Every word you produce is spoken by a text-to-speech engine, so:
- Answer in two or three sentences. Never more than four. This is a conversation, not a document.
- Write plain spoken English. No markdown, no bullet points, no headings, no emoji, no bracketed citations, no URLs.
- Expand symbols and abbreviations into words, because they will be read aloud: say "45 percent", "about 3 million dollars", "version two".
- Attribute naturally when it matters, the way a person would: "the onboarding guide says..." rather than a citation marker.

Grounding rules, which override everything above:
- Use ONLY the numbered sources given to you. They are the entire world.
- If the sources do not answer the question, say so in one short sentence and name what is missing. Never fill the gap from your own knowledge, and never guess.
- Quote exact figures, names and dates rather than rounding or paraphrasing them.
- If the user is just being social - greeting you, thanking you, saying goodbye - answer naturally in one short line without mentioning sources at all."""

TEXT_SYSTEM = """You are a retrieval-grounded assistant answering in writing.

Rules:
- Answer using ONLY the numbered sources provided. They are the entire world.
- Cite every factual claim inline with bracketed source numbers, like [1] or [2][4].
- If the sources do not contain the answer, say so plainly and name what is missing. Never fill the gap from your own knowledge.
- Quote exact figures, names and dates rather than paraphrasing them.
- Be direct and concise. No preamble, no restating the question.
- Prefer short paragraphs. Use a list only when the content is genuinely a list."""

NO_CONTEXT_VOICE = (
    "I don't have anything in the knowledge base that covers that. "
    "Try adding a document with that information and asking me again."
)

NO_DOCUMENTS_VOICE = (
    "The knowledge base is empty right now, so there's nothing for me to answer from. "
    "Add a document on the Knowledge page and ask me again."
)


# ---------------------------------------------------------------------------
# Query construction
# ---------------------------------------------------------------------------

# Openers that mean the question depends on what was said a moment ago.
_FOLLOW_UP = re.compile(
    r"^(and|but|so|what about|how about|why|why not|and what|then|also|"
    r"tell me more|more|go on|what else|who|when|where)\b",
    re.IGNORECASE,
)
_PRONOUN = re.compile(r"\b(it|its|that|this|they|them|those|these|he|she|his|her)\b", re.IGNORECASE)

# Purely social turns should not trigger a retrieval round trip at all. The test
# is a vocabulary rather than a pattern, because what makes a turn social is that
# nothing else is in it: "thanks, that was great" is social, "thanks, what does
# the warranty cover" is not, and both open the same way.
#
# At least one word has to come from here for the turn to be social at all.
_SOCIAL = {
    "hi", "hey", "hello", "yo", "hiya", "thanks", "thank", "thankyou", "cheers",
    "bye", "goodbye", "morning", "afternoon", "evening", "welcome",
    "awesome", "brilliant", "cool", "got", "great", "nice", "ok", "okay",
    "perfect", "sure",
}
# Words allowed to keep it company without making it a real question.
_FILLER = {
    "a", "again", "all", "am", "and", "are", "day", "for", "good", "help", "how",
    "i", "is", "it", "lot", "much", "please", "right", "see", "so", "that",
    "thats", "the", "there", "this", "very", "was", "well", "you", "your",
    "youre",
}

# Openings that carry no greeting word but are still not questions about the
# documents. Matched on the whole normalised turn.
_SOCIAL_PHRASES = {
    "how are you", "how are you doing", "how is it going", "hows it going",
    "whats up", "are you there", "can you hear me", "do you hear me",
}

_WORDS = re.compile(r"[a-z]+")


def is_small_talk(text: str) -> bool:
    words = _WORDS.findall(text.lower().replace("'", ""))
    if not words or len(words) > 6:
        return False
    if " ".join(words) in _SOCIAL_PHRASES:
        return True
    return any(word in _SOCIAL for word in words) and all(
        word in _SOCIAL or word in _FILLER for word in words
    )


def retrieval_query(messages: list[dict]) -> str:
    """Build the text to embed from the conversation so far.

    A spoken follow-up like "and how much did that cost?" retrieves almost
    nothing on its own. Rewriting it with an LLM would be the thorough fix, but
    that is an extra round trip in the middle of a live call. Stitching the
    previous user turn onto an obviously dependent one costs nothing and
    recovers most of the benefit.
    """
    user_turns = [m for m in messages if m.get("role") == "user" and m.get("content")]
    if not user_turns:
        return ""

    latest = str(user_turns[-1]["content"]).strip()
    if len(user_turns) == 1:
        return latest

    dependent = (
        len(latest.split()) <= 8
        or bool(_FOLLOW_UP.match(latest))
        or bool(_PRONOUN.search(latest))
    )
    if not dependent:
        return latest

    previous = str(user_turns[-2]["content"]).strip()
    return f"{previous} {latest}"


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------

def retrieve(query: str, top_k: int | None = None) -> tuple[list[dict], int]:
    """Return the chunks worth showing the model, and how long it took in ms."""
    started = time.perf_counter()
    if not query.strip():
        return [], 0

    vector = embeddings.embed_query(query)
    matches = store.search(vector, top_k or config.TOP_K)
    kept = [m for m in matches if m["score"] >= config.MIN_SCORE]
    elapsed = int((time.perf_counter() - started) * 1000)
    return kept, elapsed


def retrieve_with_vector(query: str, top_k: int | None = None):
    """Same as `retrieve`, but also hands back the query embedding.

    The Vapi path reuses that vector to write its retrieval trace, which makes
    the trace free rather than a second embedding call on the critical path.
    """
    started = time.perf_counter()
    vector = embeddings.embed_query(query)
    matches = store.search(vector, top_k or config.TOP_K)
    kept = [m for m in matches if m["score"] >= config.MIN_SCORE]
    elapsed = int((time.perf_counter() - started) * 1000)
    return kept, vector, elapsed


def build_context(chunks: list[dict]) -> str:
    blocks = []
    for i, chunk in enumerate(chunks, start=1):
        blocks.append(f"[{i}] ({chunk['title']})\n{chunk['text']}")
    return "\n\n---\n\n".join(blocks)


def _prompt_messages(
    system: str, chunks: list[dict], history: list[dict], question: str
) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": system}]

    # A few recent turns are enough for pronouns to resolve, and keeping the
    # window short keeps time-to-first-token down on a live call.
    for turn in history[-6:]:
        role = turn.get("role")
        content = str(turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append(
        {
            "role": "user",
            "content": f"Sources:\n\n{build_context(chunks)}\n\nQuestion: {question}",
        }
    )
    return messages


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def answer(
    question: str,
    chunks: list[dict],
    *,
    voice: bool = False,
    history: list[dict] | None = None,
) -> str:
    system = VOICE_SYSTEM if voice else TEXT_SYSTEM
    response = client().chat.completions.create(
        model=config.CHAT_MODEL,
        temperature=0.2,
        max_tokens=180 if voice else 1200,
        messages=_prompt_messages(system, chunks, history or [], question),
    )
    return (response.choices[0].message.content or "").strip()


def stream_answer(
    question: str,
    chunks: list[dict],
    *,
    voice: bool = False,
    history: list[dict] | None = None,
) -> Iterator[str]:
    """Yield answer text as it is generated.

    Streaming is what makes the assistant feel real-time: Vapi starts
    synthesising speech from the first sentence instead of waiting for the whole
    completion, which removes roughly a second of dead air per turn.
    """
    system = VOICE_SYSTEM if voice else TEXT_SYSTEM
    stream = client().chat.completions.create(
        model=config.CHAT_MODEL,
        temperature=0.2,
        max_tokens=180 if voice else 1200,
        stream=True,
        messages=_prompt_messages(system, chunks, history or [], question),
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        piece = chunk.choices[0].delta.content
        if piece:
            yield piece
