#!/usr/bin/env bash
set -e

echo "Setting up AfroPay-Stellar..."
echo ""

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
  echo "⚠  Edit .env with your own secrets before deploying to production."
  echo ""
fi

# Validate environment
echo "Validating environment variables..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/validate-env.sh" || true

echo ""
echo "Installing API dependencies..."
cd apps/api && npm install && cd ../..

echo ""
echo "Installing frontend dependencies..."
cd apps/frontend && npm install && cd ../..

echo ""
echo "Generating Prisma client..."
cd apps/api && npx prisma generate && cd ../..

echo ""
echo "============================================"
echo "Setup complete."
echo ""
echo "To start:              docker-compose up --build"
echo "To run API locally:    cd apps/api && npm run start:dev"
echo "To run frontend:       cd apps/frontend && npm run dev"
echo ""
echo "Remember to generate production secrets:"
echo "  JWT_SECRET:       openssl rand -base64 48"
echo "  ENCRYPTION_KEY:   openssl rand -hex 32"
echo "============================================"
