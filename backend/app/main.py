"""FastAPI app for the portfolio chatbot, run on AWS Lambda via Mangum.

CDK (infra/infra/site_stack.py) points the Lambda handler at "app.main.handler".
API Gateway forwards everything under /api/* here.
"""
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel

from .claude_client import ask_claude

app = FastAPI(title="Portfolio Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    reply = ask_claude(req.message)
    return ChatResponse(reply=reply)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


handler = Mangum(app)
