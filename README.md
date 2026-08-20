# Personal Website — Scaffold

Static portfolio site + serverless AI chatbot, deployed on AWS with CDK (Python).

## Stack

- **Frontend** (`frontend/`): plain HTML/CSS/JS, no build step. Deployed to S3, served via CloudFront.
- **Backend** (`backend/`): FastAPI app wrapped with [Mangum](https://github.com/jordaneremieff/mangum) for Lambda. Exposes `/api/chat` and `/api/health`. Calls the Anthropic API for chatbot replies, using an API key stored in AWS Secrets Manager.
- **Infra** (`infra/`): AWS CDK (Python) stack defining S3, CloudFront, API Gateway (HTTP API), Lambda, Secrets Manager, and optional Route53 + ACM for a custom domain.

Routing: CloudFront default behavior → S3 (static pages). `/api/*` behavior → API Gateway → Lambda (chatbot).

## Local development (no AWS needed)

`backend/app/local_dev.py` serves the frontend and the chatbot API from one process on one port, so `frontend/js/chat.js`'s relative `/api` calls just work.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\Activate.ps1 on Windows
pip install -r requirements-dev.txt
export ANTHROPIC_API_KEY=sk-ant-...                  # or $env:ANTHROPIC_API_KEY on PowerShell
python -m app.local_dev
```

Open http://127.0.0.1:8000/ — chatbot calls hit `http://127.0.0.1:8000/api/chat` directly on the same origin. Edit `frontend/*.html`/`css`/`js` or `backend/app/*.py` and refresh (`--reload` isn't wired up here — restart `local_dev.py` to pick up backend changes).

This path never touches AWS: `ANTHROPIC_API_KEY` is read directly, bypassing Secrets Manager entirely (see `backend/app/claude_client.py`).

## AWS deploy (do this later)

## Prerequisites

- Python 3.12+
- AWS CLI configured (`aws configure`) with credentials that can deploy CDK stacks
- AWS CDK CLI: `npm install -g aws-cdk`
- (First time in this AWS account/region) `cdk bootstrap`

## 1. Build the Lambda package

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
./build.sh
```

This installs deps into `backend/build/` alongside the app code — that folder is what CDK deploys as the Lambda asset.

## 2. Deploy infra

```bash
cd infra
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cdk deploy
```

To attach a custom domain (must already have a Route53 hosted zone for it):

```bash
cdk deploy -c domainName=yourdomain.com
```

## 3. Set the Anthropic API key

The stack creates an empty secret named `personal-site/anthropic-api-key`. Fill it after deploy:

```bash
aws secretsmanager put-secret-value \
  --secret-id personal-site/anthropic-api-key \
  --secret-string "sk-ant-..."
```

## 4. Edit content

Replace `{{Your Name}}` placeholders in `frontend/*.html` and fill in real project details on `projects.html`.

## Cost

At low traffic: S3 + CloudFront + API Gateway + Lambda all fall within (or near) AWS free tier. Rough steady cost: **$0–2/mo** plus ~$12/yr if you buy a domain through Route53.

## Redeploying after frontend edits

`cdk deploy` re-syncs `frontend/` to S3 and invalidates CloudFront automatically (via `BucketDeployment`).

## Redeploying after backend edits

Re-run `backend/build.sh`, then `cdk deploy` from `infra/`.
