#!/usr/bin/env bash
# Builds the Lambda deployment package into backend/build/.
# CDK (infra/infra/site_stack.py) deploys this folder directly as the Lambda asset.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf build
mkdir -p build

pip install -r requirements.txt -t build --upgrade
cp -r app build/

echo "Lambda package built at backend/build"
