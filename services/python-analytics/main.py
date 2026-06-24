import os
import sys

REQUIRED_ENV_VARS = {
    "DATABASE_URL": "PostgreSQL connection string for historical analysis",
    "REDIS_URL": "Redis connection string for pub/sub integration",
}

def validate_env() -> None:
    missing = []
    for key, hint in REQUIRED_ENV_VARS.items():
        if not os.environ.get(key):
            missing.append(f"  {key} — {hint}")

    if missing:
        print("[AfroPay] FATAL: Required environment variables are missing for Python Analytics.", file=sys.stderr)
        print("Set them in your environment or .env file before starting the service.", file=sys.stderr)
        print("", file=sys.stderr)
        for m in missing:
            print(m, file=sys.stderr)
        sys.exit(1)


validate_env()

from fastapi import FastAPI
from app.routes import router

app = FastAPI(title="AfroPay Fraud Detection")
app.include_router(router, prefix="/fraud")
