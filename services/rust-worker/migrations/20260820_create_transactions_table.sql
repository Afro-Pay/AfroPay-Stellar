-- Create transactions table for tracking submission status
-- and Horizon SSE confirmation status

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(255) PRIMARY KEY,
    stellar_tx_hash VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_stellar_tx_hash
ON transactions(stellar_tx_hash)
WHERE stellar_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_status
ON transactions(status);
