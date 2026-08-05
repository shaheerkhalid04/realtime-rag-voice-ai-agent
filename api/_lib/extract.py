"""Turn an uploaded file into plain text."""

import io
import os
import re


class UnsupportedFile(Exception):
    pass


class EmptyDocument(Exception):
    pass


def _clean(text: str) -> str:
    # Collapse the ragged whitespace PDF extraction tends to produce, but keep
    # paragraph breaks because the chunker splits on them first.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _from_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\n\n".join(pages)


def _from_docx(data: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(data))
    blocks = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                blocks.append(" | ".join(cells))
    return "\n\n".join(blocks)


def _from_text(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_text(filename: str, data: bytes) -> str:
    """Extract text from a supported document, raising on empty or unknown input."""
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        raw = _from_pdf(data)
    elif ext == ".docx":
        raw = _from_docx(data)
    elif ext in (".txt", ".md", ".markdown"):
        raw = _from_text(data)
    else:
        raise UnsupportedFile(
            f"'{ext or filename}' is not supported. Upload a PDF, DOCX, TXT or MD file."
        )

    text = _clean(raw)
    if not text:
        raise EmptyDocument(
            "No text could be extracted. If this is a scanned PDF it needs OCR first."
        )
    return text
