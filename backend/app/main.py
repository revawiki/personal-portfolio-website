"""FastAPI app for the portfolio chatbot, run on AWS Lambda via Mangum.

CDK (infra/infra/site_stack.py) points the Lambda handler at "app.main.handler".
API Gateway forwards everything under /api/* here.
"""
import logging
import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel, Field

from .claude_client import ChatUpstreamError, ask_claude

logger = logging.getLogger(__name__)

app = FastAPI(title="Portfolio Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

# Hard input bounds. The widget enforces the same message cap client-side;
# these are the authoritative ones.
MAX_MESSAGE_CHARS = 1000
MAX_TURN_CHARS = 2000
MAX_HISTORY_ITEMS = 20


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_TURN_CHARS)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    history: list[Turn] = Field(default_factory=list, max_length=MAX_HISTORY_ITEMS)


class ChatResponse(BaseModel):
    reply: str
    # deflected: the model declined an out-of-scope request or had no answer
    # (widget shows the direct-contact CTA after two in a row).
    # contact: the reply invites talking to Reva directly, e.g. hiring or
    # collaboration interest (widget shows the CTA immediately).
    deflected: bool = False
    contact: bool = False


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    history = [{"role": t.role, "content": t.content} for t in req.history]
    try:
        reply, deflected, contact = ask_claude(message, history)
    except ChatUpstreamError as exc:
        logger.warning("chat upstream failure: %s", exc)
        status = 429 if exc.retryable else 502
        raise HTTPException(
            status_code=status,
            detail="The assistant is unavailable right now. Try again in a moment, "
            "or email reva.wiki@gmail.com.",
        ) from exc

    if not reply:
        raise HTTPException(status_code=502, detail="Empty reply from the model.")
    return ChatResponse(reply=reply, deflected=deflected, contact=contact)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


handler = Mangum(app)
