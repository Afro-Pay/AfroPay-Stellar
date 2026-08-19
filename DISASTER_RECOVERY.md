# AfroPay Disaster Recovery Runbook

## 1. Overview
**Purpose**: Recover AfroPay after data loss or outage
**Scope**: PostgreSQL, Redis, Soroban Contracts  
**RTO**: < 1 hour  |  **RPO**: < 15 minutes
**Owner**: @NuruddeenA97234

## 2. PostgreSQL PITR
### Backup
pgBackRest + WAL to S3 every 5min

### Restore
1. Stop API: `systemctl stop afropay-api`
2. Restore: `pgbackrest restore --stanza=afropay --target-time="YYYY-MM-DD HH:MM:SS"`
3. Start DB: `systemctl start postgresql`
4. Verify data

## 3. Redis Recovery  
### Backup
RDB every 15min + AOF

### Restore
1. Stop Redis: `systemctl stop redis`
2. Copy dump.rdb from s3://afropay-backups/redis/
3. Start Redis: `systemctl start redis`

## 4. Soroban Contract Recovery
1. Verify WASM hash: `stellar contract info --id CONTRACT_ID --network mainnet`
2. Replay Horizon events 24h
3. Re-init config via multi-sig

## 5. Checklist
- [ ] API 200 OK
- [ ] DB counts match  
- [ ] Redis hit rate > 80%
- [ ] Contract tests pass

## 6. Dry Run
Test restore on staging: `scripts/dr-test.sh`
