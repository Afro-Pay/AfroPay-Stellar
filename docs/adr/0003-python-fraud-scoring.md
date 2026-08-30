# ADR 0003: Python for Fraud Scoring

## Status

Accepted

## Context

AfroPay-Stellar requires real-time fraud detection and risk scoring for cross-border remittances. The system must:

- Ingest transaction history from PostgreSQL
- Apply statistical models and heuristics (velocity checks, outlier detection, geographic anomalies)
- Emit risk scores and alerts for suspicious patterns
- Integrate seamlessly with the NestJS API and Rust worker

The team evaluated three implementation languages: Python, Rust, and TypeScript, with different trade-offs in data science agility, performance, and ecosystem maturity.

## Decision Drivers

1. **Data Science Flexibility**: Fraud patterns evolve; the team needs rapid iteration and easy model experimentation.
2. **Ecosystem Maturity**: Scikit-learn, pandas, NumPy, and TensorFlow are production-ready; Rust equivalents are emerging.
3. **Integration Speed**: Must connect to PostgreSQL and publish risk signals efficiently.
4. **Operational Simplicity**: Fraud service should be lightweight and easy to deploy independently.
5. **Team Skills**: Existing team experience with Python data science tools.
6. **Cost**: Resource efficiency for a non-critical-path service (runs asynchronously on settled transactions).

## Considered Options

### Option 1: Rust (Rejected)

Implement fraud scoring in Rust within the main worker service.

**Pros**:

- Single deployment unit (no separate service needed)
- Best performance and memory efficiency
- Type safety; compile-time guarantees
- Leverages existing Rust worker infrastructure

**Cons**:

- Rust data science ecosystem is nascent; no mature equivalents to scikit-learn
- Steeper learning curve for statistical modeling
- Slower iteration on model experimentation
- Library maintenance risk; scipy/pandas equivalents may lag
- Team lacks deep Rust ML experience
- Difficult to integrate third-party ML models (trained in Python)

### Option 2: TypeScript / Node.js (Rejected)

Implement fraud scoring as a NestJS module or separate Node.js service.

**Pros**:

- Same language as API; easier code sharing
- JavaScript ML libraries available (TensorFlow.js, simple-statistics)
- Fits existing TypeScript monorepo structure

**Cons**:

- JavaScript performance overhead for data-heavy operations
- ML ecosystem in Node.js lags Python significantly
- No native scipy, scikit-learn, or pandas equivalents
- Matrix operations and statistical functions slower than NumPy
- Harder to integrate pre-trained models built in Python

### Option 3: Python (Chosen)

Implement fraud scoring as a separate FastAPI/Flask microservice consuming PostgreSQL and publishing to Redis or directly to the API.

**Pros**:

- Mature, battle-tested ML ecosystem: scikit-learn, pandas, NumPy, TensorFlow
- Rapid model iteration and experimentation
- Easy to integrate pre-trained models (joblib, onnx, HuggingFace)
- Native statistical functions and anomaly detection libraries
- Simple data ingestion from PostgreSQL (sqlalchemy, psycopg2)
- Independent deployment; fraud updates don't require API restarts
- Large community and third-party model availability
- Excellent debugging and interactive notebooks (Jupyter) for model development

**Cons**:

- Separate service adds operational complexity (deployment, monitoring, scaling)
- Language mismatch; team must manage Python ecosystem
- Potential network latency if fraud checks block transactions (mitigated by async design)
- Python dependency management (poetry, pipenv, or pip)
- Memory footprint higher than Rust or compiled solutions

## Decision Outcome

**Chosen: Python with FastAPI**

Fraud scoring runs as an independent microservice (`services/python-analytics`) that:

1. **Consumes data** from PostgreSQL (transaction history, user profiles)
2. **Applies models** via scikit-learn, pandas, custom heuristics
3. **Publishes signals** via HTTP endpoint to the API or Redis pub/sub
4. **Operates asynchronously** on settled transactions to avoid blocking remittances

Implementation sketch in `services/python-analytics/app/fraud_checker.py`:

```python
import pandas as pd
from sklearn.ensemble import IsolationForest
from sqlalchemy import create_engine

class FraudChecker:
    def __init__(self, db_url: str):
        self.engine = create_engine(db_url)
        self.isolation_forest = IsolationForest(contamination=0.05)

    def score_transaction(self, transaction: dict) -> float:
        """
        Return risk score 0.0–1.0.
        """
        # Velocity check: how many transfers in last hour?
        velocity = self._get_velocity(transaction['sender_id'])

        # Geographic anomaly: is destination country unusual?
        geo_risk = self._geo_anomaly_score(transaction['destination_country'])

        # Amount outlier: is this amount unusual for this user?
        amount_outlier = self._amount_outlier_score(transaction)

        # Combine signals
        return max(velocity, geo_risk, amount_outlier)

    def _get_velocity(self, user_id: str) -> float:
        query = """
            SELECT COUNT(*) as count FROM transfers
            WHERE sender_id = %s AND created_at > NOW() - INTERVAL '1 hour'
        """
        df = pd.read_sql(query, self.engine, params=[user_id])
        count = df['count'].iloc[0]
        return min(count / 10.0, 1.0)  # 10+ transfers/hour = 1.0 risk

    def _geo_anomaly_score(self, country: str) -> float:
        # Load user's historical destinations
        # Check if country is unusual
        # Return 0.0–1.0
        pass

    def _amount_outlier_score(self, transaction: dict) -> float:
        # Use Isolation Forest to detect outlier amounts
        pass
```

The API calls the fraud service asynchronously after a transaction settles:

```typescript
// After transaction is settled in Stellar
await this.fraudClient.post("/fraud/score", {
  transactionId: txId,
  amount: transfer.amount,
  sender: transfer.sender,
  destination_country: transfer.destination_country,
});
```

## Consequences

### Positive

1. **Data Science Agility**: Fast iteration on models without recompiling or redeploying core services.
2. **Ecosystem Strength**: Access to mature, production-proven libraries (scikit-learn, pandas, TensorFlow).
3. **Rapid Integration**: Pre-trained models from HuggingFace or open-source research easily integrated.
4. **Independent Scaling**: Fraud service scales separately from API; can be disabled or throttled without affecting remittances.
5. **Debugging**: Interactive notebooks enable ad-hoc analysis and model validation.
6. **Community**: Large ML community; easy to find solutions to novel fraud patterns.

### Negative

1. **Operational Complexity**: Separate service requires Docker, orchestration, and monitoring setup.
2. **Language Overhead**: Team must manage Python dependencies, virtual environments, and package updates.
3. **Memory/CPU**: Python overhead compared to Rust; more resources needed for same throughput.
4. **Integration Delay**: If fraud checks are synchronous, adds latency to transaction completion.
5. **Dependency Lock-In**: Heavy reliance on scikit-learn and pandas; future replacement is costly.
6. **Cold Start**: If fraud service is serverless, initialization can take 10–30 seconds.

## Links

- Related: [ADR 0001: BullMQ for Asynchronous Settlement](./0001-bullmq-async-settlement.md) — fraud scoring runs asynchronously on settled transactions
- Reference: [Architecture Overview](../architecture.md#analytics)
- Reference: [Scikit-learn Documentation](https://scikit-learn.org/)
- Reference: [Pandas Documentation](https://pandas.pydata.org/)
- Reference: [FastAPI Documentation](https://fastapi.tiangolo.com/)
