#!/usr/bin/env bash
# Builds the Lambda deployment package into backend/build/.
# CDK (infra/infra/site_stack.py) deploys this folder directly as the Lambda asset.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf build
mkdir -p build

pip install -r requirements.txt -t build --upgrade
cp -r app build/
# The chatbot's knowledge base is the same curated summary served to AI
# crawlers -- one source of truth, copied into the bundle at package time
# (claude_client.py looks for app/knowledge.md first, frontend/llms.txt
# second, so local dev needs no copy).
cp ../frontend/llms.txt build/app/knowledge.md

echo "Lambda package built at backend/build"
