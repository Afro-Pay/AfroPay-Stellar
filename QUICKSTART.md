# AfroPay — Quick Start Guide

Welcome to AfroPay! This guide will get you up and running in under 10 minutes.

---

## 🚀 Installation (5 minutes)

### Prerequisites
- **Node.js 18+** (check with `node --version`)
- **Docker & Docker Compose** (for database & Redis)
- **Git**

### Step 1: Clone & Install

```bash
# Clone the repository
git clone https://github.com/afropay/afropay-stellar.git
cd afropay-stellar

# Install dependencies
npm install

# Install Rust (for contract development)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

### Step 2: Setup Environment

```bash
# Copy example environment file
cp .env.example .env

# Generate JWT secret
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

# Generate Soroban test keys
stellar keys generate admin-testnet > /tmp/admin-keys.txt
cat /tmp/admin-keys.txt >> .env
```

### Step 3: Start Services

```bash
# Terminal 1: Start database & Redis
docker-compose up -d postgres redis

# Wait for services to be healthy
sleep 5

# Terminal 2: Run database migrations
cd apps/api
npx prisma migrate dev --name init

# Terminal 3: Start API server
npm run start:dev

# Should output: [Nest] .... LOG [NestApplication] Nest application successfully started
```

### Step 4: Start Frontend

```bash
# Terminal 4: Start Next.js frontend
cd apps/frontend
npm run dev

# Visit http://localhost:3000 in your browser
```

---

## 🧪 First Transfer (3 minutes)

### 1. Register Account

```bash
# POST http://localhost:3000
# Click "Sign Up" and enter:
# - Email: your@email.com
# - Password: secure_password_123
```

### 2. Create Wallet

```bash
# After login, click "Create Wallet"
# A Stellar wallet is generated and stored securely
```

### 3. Send Money

```bash
# Click "Send Money"
# Fill in:
# - Recipient Country: Nigeria (NG)
# - Amount: 100 NGN
# Click "Send Money"
# You'll see the escrow ID (e.g., escrow_12345)
```

### 4. Monitor Transfer

```bash
# Click the transaction to view live status
# You'll see:
# - Status: PENDING
# - Timeline showing when oracle will confirm delivery
# - Expected completion: ~5-10 minutes
```

---

## 📚 API Examples

### Create Wallet

```bash
curl -X POST http://localhost:3001/wallet/create \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"

# Response:
# {
#   "publicKey": "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQA7XXZQ2D5YPEXAKYV64ECYF",
#   "status": "success"
# }
```

### Initiate Transfer

```bash
curl -X POST http://localhost:3001/transaction/initiate \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "recipientCountry": "NG",
    "fiatAmount": 100,
    "fiatCurrency": "NGN"
  }'

# Response:
# {
#   "transactionId": "uuid",
#   "escrowId": "escrow_12345",
#   "status": "PENDING",
#   "amount": "1000000000",
#   "usdcAmount": "0.24",
#   "fiatAmount": 100,
#   "fiatCurrency": "NGN",
#   "exchangeRate": "411.5",
#   "estimatedTime": "5-10 minutes"
# }
```

### Get Transaction Status

```bash
curl -X GET http://localhost:3001/transaction/uuid \
  -H "Authorization: Bearer <your_jwt_token>"

# Response includes full escrow state from Soroban contract
```

---

## 🔧 Smart Contract Development

### Build Contract

```bash
cd afropay-stellar-contract

# Compile to WASM
cargo build --release --target wasm32-unknown-unknown

# Optimize size
wasm-opt -Oz target/wasm32-unknown-unknown/release/afropay_stellar_contract.wasm \
  -o afropay.wasm

# Check size (should be < 100 KB)
ls -lh afropay.wasm
```

### Run Tests

```bash
# Unit tests
cargo test --lib

# Integration tests
cargo test --test integration_test -- --nocapture

# With logging
RUST_LOG=debug cargo test -- --nocapture
```

### Deploy to Testnet

```bash
# Set testnet as active network
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export STELLAR_NETWORK=testnet

# Generate keypair
stellar keys generate admin-testnet

# Fund with testnet XLM
curl "https://friendbot.stellar.org/?addr=$(stellar keys show admin-testnet)"

# Deploy contract
stellar contract deploy \
  --wasm afropay.wasm \
  --network testnet \
  --issuer admin-testnet

# Save returned CONTRACT_ID
export SOROBAN_CONTRACT_ADDRESS=<returned_id>
echo "SOROBAN_CONTRACT_ADDRESS=$SOROBAN_CONTRACT_ADDRESS" >> .env
```

---

## 📊 Monitoring & Debugging

### View API Logs

```bash
# Real-time logs from API server
cd apps/api
npm run start:dev -- --verbose
```

### Check Database

```bash
# Connect to PostgreSQL
psql -h localhost -U afropay -d afropay_dev

# View transactions
SELECT id, destination, amount, status FROM "Transaction" ORDER BY created_at DESC LIMIT 10;

# View wallets
SELECT id, "userId", "publicKey" FROM "Wallet";

# Exit
\q
```

### Monitor Redis Queue

```bash
# Connect to Redis
redis-cli

# View queues
KEYS *

# Check queue length
LLEN bull:transactions:

# View queue jobs
LRANGE bull:transactions: 0 -1

# Exit
exit
```

### Test Fraud Detection

```bash
# Call fraud service directly
curl -X POST http://localhost:8001/score \
  -H "Content-Type: application/json" \
  -d '{
    "tx_id": "test_123",
    "amount": 5000,
    "destination_country": "NG",
    "source_country": "US"
  }'

# Response:
# {
#   "tx_id": "test_123",
#   "risk_score": 0.3,
#   "flagged": false,
#   "reasons": []
# }
```

---

## 🐛 Troubleshooting

### Database Connection Error

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# If not running, start services
docker-compose up -d postgres redis

# Check logs
docker-compose logs postgres

# Verify credentials in .env
cat .env | grep DATABASE_URL
```

### API Won't Start

```bash
# Check if port 3001 is in use
lsof -i :3001

# Kill the process if needed
kill -9 <PID>

# Or use different port
PORT=3002 npm run start:dev
```

### Frontend Build Issues

```bash
# Clear cache and reinstall
cd apps/frontend
rm -rf .next node_modules
npm install
npm run dev
```

### Contract Deployment Fails

```bash
# Check WASM file exists and is valid
file afropay.wasm

# Check file size
ls -lh afropay.wasm  # Should be < 100 KB

# Verify Stellar network is accessible
curl https://soroban-testnet.stellar.org/health

# Check admin account has XLM
stellar account $(stellar keys show admin-testnet) --network testnet
```

---

## 📖 Next Steps

### Learn More
- **Smart Contract Design:** Read [docs/contract-design.md](docs/contract-design.md)
- **Oracle Integration:** Read [afropay-stellar-contract/docs/oracle-integration.md](afropay-stellar-contract/docs/oracle-integration.md)
- **Deployment:** Read [docs/deployment.md](docs/deployment.md)

### Contribute
- Found a bug? [Open an issue](https://github.com/afropay/afropay-stellar/issues)
- Want to help? See [CONTRIBUTING.md](./Contributorsguide.md)

### Community
- **Discord:** [Join AfroPay Community](https://discord.gg/afropay)
- **Twitter:** [@AfroPay](https://twitter.com/afropay)
- **GitHub:** [Star us!](https://github.com/afropay/afropay-stellar) ⭐

---

## 🚀 Deployment

### Local Docker Deployment

```bash
# Start all services with Docker Compose
docker-compose up -d

# Check services are healthy
docker-compose ps

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down
```

### Cloud Deployment

See [docs/deployment.md](docs/deployment.md) for step-by-step AWS, Heroku, or DigitalOcean deployment guides.

---

## ❓ FAQ

**Q: Can I use this with Mainnet?**  
A: Yes! Update `.env` with `STELLAR_NETWORK=public` and deploy the contract to mainnet.

**Q: How much does a transfer cost?**  
A: Transaction fees are ~1-2 stroops (< $0.00001). AfroPay charges 0.5% on transfers.

**Q: What's the refund mechanism?**  
A: If the oracle doesn't confirm delivery within the timeout (default 2 hours), the sender can automatically claim a refund.

**Q: Can I add new countries?**  
A: Yes! Add a new entry in the `supportedCountries` array and configure a local off-ramp partner as an oracle.

**Q: Is the contract audited?**  
A: We're working on a professional audit. Current version has passed internal testing.

---

**Questions?** Post on [GitHub Discussions](https://github.com/afropay/afropay-stellar/discussions)

**Ready to go live?** Jump to [Deployment Guide](docs/deployment.md)

---

🌍 **Built with ❤️ for financial inclusion in Africa.**
