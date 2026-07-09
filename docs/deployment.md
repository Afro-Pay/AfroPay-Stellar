# AfroPay Deployment Guide

## 1. Prerequisites

### Required Software
- Node.js 18+ (npm 9+)
- Rust 1.70+ (for Soroban contract)
- Docker & Docker Compose
- PostgreSQL 14+ or cloud database (AWS RDS, Neon, etc.)
- Stellar CLI

### Required Accounts
- Stellar Testnet/Mainnet account (with XLM for fees)
- GitHub (for CI/CD)
- AWS (S3, CloudFormation) or equivalent cloud provider
- Circle (USDC issuer account)

---

## 2. Phase 1: Testnet Deployment (Week 1-4)

### 2.1 Setup Local Environment

```bash
# Clone repository
git clone https://github.com/afropay/afropay-stellar.git
cd afropay-stellar

# Install dependencies
npm install

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Setup environment
cp .env.example .env
# Edit .env with your testnet keys and RPC URLs
```

### 2.2 Build Soroban Contract

```bash
# Navigate to contract directory
cd afropay-stellar-contract

# Build WASM
cargo build --release --target wasm32-unknown-unknown

# Optimize contract size
wasm-opt -Oz target/wasm32-unknown-unknown/release/afropay_stellar_contract.wasm -o afropay.wasm

# Test locally
cargo test --lib
```

### 2.3 Deploy to Stellar Testnet

```bash
# Set network to testnet
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export STELLAR_NETWORK=testnet

# Generate admin keypair (save securely)
stellar keys generate admin-testnet

# Fund admin account with testnet XLM
curl "https://friendbot.stellar.org/?addr=$(stellar keys show admin-testnet)"

# Deploy contract
stellar contract deploy \
  --wasm afropay.wasm \
  --network testnet \
  --issuer admin-testnet

# Note the returned CONTRACT_ID and save to .env
export SOROBAN_CONTRACT_ADDRESS=<returned_contract_id>
```

### 2.4 Initialize Contract

```bash
# Create admin initialization transaction
stellar contract invoke \
  --id $SOROBAN_CONTRACT_ADDRESS \
  --network testnet \
  --source admin-testnet \
  -- \
  initialize \
  --admin $(stellar keys show admin-testnet)
```

### 2.5 Setup Database

```bash
# Create PostgreSQL database
createdb afropay_dev

# Run migrations
cd apps/api
npx prisma migrate dev --name init

# Check migrations
npx prisma migrate status
```

### 2.6 Launch API Server

```bash
# Terminal 1: Start NestJS API
cd apps/api
npm run start:dev

# Should output:
# [Nest] 12345 - 01/15/2024, 10:30:00 AM     LOG [NestFactory] Starting Nest application...
# [Nest] 12345 - 01/15/2024, 10:30:02 AM     LOG [InstanceLoader] SorobanModule dependencies initialized
# [Nest] 12345 - 01/15/2024, 10:30:03 AM     LOG [InstanceLoader] TransactionModule dependencies initialized
# [Nest] 12345 - 01/15/2024, 10:30:04 AM     LOG [NestApplication] Nest application successfully started
```

### 2.7 Launch Frontend

```bash
# Terminal 2: Start Next.js Frontend
cd apps/frontend
npm run dev

# Should output:
# ▲ Next.js 15.0.0
# - Local:        http://localhost:3000
# - Environments: .env, .env.local
```

### 2.8 Launch Python Fraud Service

```bash
# Terminal 3: Start Python analytics service
cd services/python-analytics
pip install -r requirements.txt
python main.py

# Should output:
# INFO:     Started server process [12345]
# INFO:     Waiting for application startup.
# INFO:     Application startup complete [00.00s]
# INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 2.9 Launch Rust Worker

```bash
# Terminal 4: Start Rust background worker
cd services/rust-worker
cargo run --release

# Should output:
# Starting Rust worker...
# Connected to Redis
# Listening for transactions...
```

---

## 3. Phase 2: Testing & Validation

### 3.1 Run Test Suite

```bash
# Soroban contract tests
cd afropay-stellar-contract
cargo test --lib -- --nocapture

# NestJS API tests
cd apps/api
npm run test

# Frontend tests
cd apps/frontend
npm run test
```

### 3.2 Integration Tests

```bash
# Create test user account
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tester@afropay.io",
    "password": "test_password_123"
  }'

# Create wallet
curl -X POST http://localhost:3001/wallet/create \
  -H "Authorization: Bearer <jwt_token>"

# Initiate test transfer
curl -X POST http://localhost:3001/transaction/initiate \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "recipientCountry": "NG",
    "fiatAmount": 100,
    "fiatCurrency": "NGN"
  }'
```

### 3.3 Monitor Testnet Activity

```bash
# View contract state on testnet
stellar info \
  --id $SOROBAN_CONTRACT_ADDRESS \
  --network testnet

# Check transaction history
stellar transactions list \
  --account $(stellar keys show admin-testnet) \
  --network testnet

# Monitor escrows
curl "https://soroban-testnet.stellar.org/getLedgerEntries" \
  -d '[{"contractData": {"contract": {"type": "stellar_asset", "contractId": "'$SOROBAN_CONTRACT_ADDRESS'"}}]}'
```

---

## 4. Phase 3: Production Deployment

### 4.1 Production Environment Setup

```bash
# Create production .env
cp .env.example .env.production

# Configure production variables
export STELLAR_NETWORK=public
export SOROBAN_RPC_URL=https://soroban.stellar.org
export DATABASE_URL=postgresql://user:pass@prod-db.aws.amazon.com/afropay_prod
export FRAUD_SERVICE_URL=https://fraud-api.afropay.io
export LOG_LEVEL=info
export NODE_ENV=production
```

### 4.2 Deploy Soroban Contract to Mainnet

```bash
# Generate mainnet admin keypair (use hardware wallet or HSM)
stellar keys generate admin-mainnet --fabric-name myHSM

# Fund admin account with mainnet XLM
# (Send from exchange or existing account)
stellar send \
  --source-secret $STELLAR_SECRET \
  --destination $(stellar keys show admin-mainnet) \
  --amount 100 \
  --asset native

# Deploy contract to mainnet
stellar contract deploy \
  --wasm afropay.wasm \
  --network public \
  --issuer admin-mainnet

# Save CONTRACT_ID to production .env
```

### 4.3 Deploy Infrastructure (AWS)

```bash
# Create CloudFormation stack
aws cloudformation create-stack \
  --stack-name afropay-prod \
  --template-body file://infrastructure/cloudformation.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=production \
    ParameterKey=DBInstanceClass,ParameterValue=db.t3.large \
    ParameterKey=DesiredCount,ParameterValue=3

# Wait for stack creation
aws cloudformation wait stack-create-complete \
  --stack-name afropay-prod

# Get outputs
aws cloudformation describe-stacks \
  --stack-name afropay-prod \
  --query 'Stacks[0].Outputs' \
  --output table
```

### 4.4 Deploy Containers to ECS

```bash
# Build Docker images
docker build -t afropay-api:latest apps/api
docker build -t afropay-frontend:latest apps/frontend
docker build -t afropay-worker:latest services/rust-worker
docker build -t afropay-fraud:latest services/python-analytics

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com
docker tag afropay-api:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/afropay-api:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/afropay-api:latest

# Update ECS service
aws ecs update-service \
  --cluster afropay-prod \
  --service afropay-api \
  --force-new-deployment
```

### 4.5 Setup CDN & SSL

```bash
# Create CloudFront distribution
aws cloudfront create-distribution \
  --distribution-config file://infrastructure/cloudfront-config.json

# Request SSL certificate
aws acm request-certificate \
  --domain-name afropay.io \
  --subject-alternative-names "www.afropay.io" "api.afropay.io"

# Validate certificate (via email or DNS)
# Update Route53 with CNAME records
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://infrastructure/dns-records.json
```

### 4.6 Initialize Production Database

```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier afropay-prod-db \
  --db-instance-class db.t3.large \
  --engine postgres \
  --master-username admin \
  --master-user-password $(openssl rand -base64 32) \
  --allocated-storage 100

# Run migrations
PGHOST=$(aws rds describe-db-instances --db-instance-identifier afropay-prod-db --query 'DBInstances[0].Endpoint.Address' --output text)
PGPASSWORD=$DB_PASSWORD psql -h $PGHOST -U admin -d afropay_prod -f migrations/001_initial.sql
```

### 4.7 Setup Monitoring & Alerts

```bash
# Create CloudWatch dashboard
aws cloudwatch put-dashboard \
  --dashboard-name afropay-prod \
  --dashboard-body file://infrastructure/cloudwatch-dashboard.json

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name afropay-api-cpu-high \
  --alarm-description "Alert when API CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold

# Setup logging
aws logs create-log-group --log-group-name /afropay/api
aws logs create-log-group --log-group-name /afropay/worker
aws logs create-log-group --log-group-name /afropay/fraud
```

---

## 5. Maintenance & Monitoring

### 5.1 Daily Checks

```bash
# Check API health
curl https://api.afropay.io/health

# View API logs
aws logs tail /afropay/api --follow

# Monitor escrow transactions
curl https://api.afropay.io/admin/metrics

# Check oracle status
curl https://api.afropay.io/admin/oracles
```

### 5.2 Database Backups

```bash
# Create RDS snapshot
aws rds create-db-snapshot \
  --db-instance-identifier afropay-prod-db \
  --db-snapshot-identifier afropay-prod-backup-$(date +%Y%m%d)

# Automated backups (enable in RDS)
aws rds modify-db-instance \
  --db-instance-identifier afropay-prod-db \
  --backup-retention-period 30 \
  --apply-immediately
```

### 5.3 Security Updates

```bash
# Update Rust dependencies
cd afropay-stellar-contract
cargo update

# Update Node dependencies
cd apps/api
npm audit fix

# Update Docker base images
docker build --no-cache -t afropay-api:latest apps/api

# Run security scan
trivy image afropay-api:latest
```

---

## 6. Troubleshooting

### Issue: Contract deployment fails

```bash
# Check contract size
ls -lh afropay.wasm

# Optimize if > 64KB
wasm-opt -Oz afropay.wasm -o afropay-optimized.wasm

# Verify WASM is valid
wasm-objdump -h afropay.wasm | head -20
```

### Issue: Database connection fails

```bash
# Test connection
psql -h $PGHOST -U admin -d afropay_prod -c "SELECT 1;"

# Check credentials
echo $DATABASE_URL

# View RDS logs
aws rds describe-db-log-files --db-instance-identifier afropay-prod-db
```

### Issue: Transactions failing

```bash
# Check API logs
aws logs filter-log-events --log-group-name /afropay/api --filter-pattern "ERROR"

# View contract errors
curl "https://soroban.stellar.org/getTransactionResult?hash=$TX_HASH"

# Check oracle attestations
curl https://api.afropay.io/admin/attestations --limit 10
```

---

## 7. Disaster Recovery

### 7.1 Restore from Backup

```bash
# List available snapshots
aws rds describe-db-snapshots --db-instance-identifier afropay-prod-db

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier afropay-prod-db-restore \
  --db-snapshot-identifier afropay-prod-backup-20240115 \
  --db-instance-class db.t3.large
```

### 7.2 Contract Upgrade

```bash
# Deploy new contract version
stellar contract deploy \
  --wasm afropay-v2.wasm \
  --network public \
  --issuer admin-mainnet

# Initiate migration (multi-step)
# 1. Old contract pauses
# 2. New contract receives migration data
# 3. New contract resumes
```

---

## 8. Compliance & Audits

### 8.1 Regulatory Reporting

```bash
# Export transaction logs
psql -h $PGHOST -d afropay_prod \
  -c "SELECT * FROM transactions WHERE created_at > '2024-01-01' ORDER BY created_at DESC LIMIT 10000;" \
  -o transactions_2024_01.csv

# Generate audit report
curl https://api.afropay.io/admin/audit-report > audit_2024_01.json
```

### 8.2 Security Audit

```bash
# Run contract audit
cd afropay-stellar-contract
cargo audit

# OWASP security scan
docker run -t owasp/zap:latest zap-baseline.py -t https://api.afropay.io

# Code coverage
cd apps/api
npm run test:cov
```

---

**Deployment Guide Version:** 1.0  
**Last Updated:** 2024
