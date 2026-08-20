"""Wraps the Anthropic API call used by the /api/chat endpoint.

In AWS, the API key comes from Secrets Manager (see infra/infra/site_stack.py,
secret name "personal-site/anthropic-api-key") via ANTHROPIC_SECRET_ARN.
For local dev (no AWS credentials needed), set ANTHROPIC_API_KEY instead --
boto3 is only imported if that's absent, so it's never required locally, and
it isn't listed in backend/requirements.txt since Lambda's runtime ships it.
"""
import os
from functools import lru_cache

import anthropic

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
SECRET_ARN = os.environ.get("ANTHROPIC_SECRET_ARN")
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")
MAX_TOKENS = 512

SYSTEM_PROMPT = (
    "You are a chatbot embedded in a software engineer's personal portfolio "
    "website. Answer questions about their projects, skills, and experience "
    "based on the site's content. Be concise and friendly. If you don't know "
    "an answer, say so instead of guessing."
)


@lru_cache(maxsize=1)
def _get_api_key() -> str:
    if API_KEY:
        return API_KEY
    if not SECRET_ARN:
        raise RuntimeError(
            "Set ANTHROPIC_API_KEY (local dev) or ANTHROPIC_SECRET_ARN (AWS)"
        )
    import boto3

    client = boto3.client("secretsmanager")
    value = client.get_secret_value(SecretId=SECRET_ARN)
    return value["SecretString"]


@lru_cache(maxsize=1)
def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=_get_api_key())


def _dummy_reply(message: str) -> str:
    return (
        "[dummy reply -- no ANTHROPIC_API_KEY set] "
        f"You said: \"{message}\". Set ANTHROPIC_API_KEY to talk to the real Claude API."
    )


def ask_claude(message: str) -> str:
    if not API_KEY and not SECRET_ARN:
        return _dummy_reply(message)

    client = _get_client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": message}],
    )
    return response.content[0].text
