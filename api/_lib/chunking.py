"""A small recursive character splitter.

Deliberately dependency-free: pulling in LangChain just for this would add tens
of megabytes to a serverless bundle that has a 250 MB ceiling, and every other
piece of the pipeline here is a single API call anyway.
"""

import re

# Tried in order. Splitting on the largest natural boundary that fits keeps
# related sentences together, which is what actually drives retrieval quality.
SEPARATORS = ("\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ")


def _split_on(text: str, separator: str) -> list[str]:
    if separator == " ":
        return text.split(" ")
    parts = text.split(separator)
    # Re-attach the separator so sentences keep their punctuation.
    return [p + separator for p in parts[:-1]] + [parts[-1]]


def _merge(pieces: list[str], size: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for piece in pieces:
        piece_len = len(piece)
        if current and current_len + piece_len > size:
            chunks.append("".join(current).strip())
            # Walk backwards to build the overlap window for the next chunk.
            tail: list[str] = []
            tail_len = 0
            for previous in reversed(current):
                if tail_len + len(previous) > overlap:
                    break
                tail.insert(0, previous)
                tail_len += len(previous)
            current = tail
            current_len = tail_len
        current.append(piece)
        current_len += piece_len

    if current:
        chunks.append("".join(current).strip())
    return [c for c in chunks if c]


def split_text(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    """Split text into overlapping chunks of roughly `size` characters."""
    if len(text) <= size:
        return [text.strip()] if text.strip() else []

    for separator in SEPARATORS:
        pieces = _split_on(text, separator)
        if len(pieces) < 2:
            continue
        # If a single piece still blows past the budget, fall through to a finer
        # separator rather than emitting an oversized chunk.
        if max(len(p) for p in pieces) > size and separator != " ":
            continue
        return _merge(pieces, size, overlap)

    # Nothing to split on (e.g. one enormous unbroken token) - hard wrap it.
    step = size - overlap
    return [text[i : i + size] for i in range(0, len(text), step)]


_WORD = re.compile(r"\b\w+\b")


def word_count(text: str) -> int:
    return len(_WORD.findall(text))
