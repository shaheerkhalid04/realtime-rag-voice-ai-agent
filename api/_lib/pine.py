"""Lazily-constructed Pinecone client, shared across warm invocations."""

from . import config

_client = None


class MissingCredentials(Exception):
    pass


def client():
    global _client
    if _client is None:
        if not config.PINECONE_API_KEY:
            raise MissingCredentials(
                "PINECONE_API_KEY is not set. Add it to .env.local or your Vercel project."
            )
        from pinecone import Pinecone

        _client = Pinecone(api_key=config.PINECONE_API_KEY)
    return _client
