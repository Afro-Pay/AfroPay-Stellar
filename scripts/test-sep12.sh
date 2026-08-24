#!/bin/bash
set -e

echo "Starting Stellar Anchor Validator for SEP-12..."
# Typically the stellar anchor validator is run via docker or directly:
# docker run --rm -it stellar/anchor-validator --url http://host.docker.internal:3000 --seps 12

echo "Testing SEP-12 endpoints on http://localhost:3000..."
docker run --network host --rm stellar/anchor-validator \
  --url http://localhost:3000 \
  --seps 12 \
  --sep12-unauth-test true

echo "SEP-12 validation completed!"
