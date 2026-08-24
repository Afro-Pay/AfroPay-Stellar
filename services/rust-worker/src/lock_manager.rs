use anyhow::{anyhow, Result};
use redis::{aio::Connection, AsyncCommands, Client, Script};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::task::JoinHandle;

const DEFAULT_TTL: Duration = Duration::from_secs(10);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(3);
const RELEASE_SCRIPT: &str =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const EXTEND_SCRIPT: &str =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

#[derive(Clone)]
pub struct LockManager {
    client: Client,
}

pub struct LockGuard {
    manager: Arc<LockManager>,
    key: String,
    token: String,
    heartbeat: Option<JoinHandle<()>>,
}

impl LockManager {
    pub fn new(client: Client) -> Arc<Self> {
        Arc::new(Self { client })
    }

    pub async fn acquire(self: &Arc<Self>, key: impl Into<String>) -> Result<LockGuard> {
        self.acquire_with_ttl(key.into(), DEFAULT_TTL).await
    }

    async fn connection(&self) -> Result<Connection> {
        Ok(self.client.get_async_connection().await?)
    }

    async fn acquire_with_ttl(self: &Arc<Self>, key: String, ttl: Duration) -> Result<LockGuard> {
        let token = format!(
            "{}:{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
        );
        let mut connection = self.connection().await?;
        let acquired: Option<String> = redis::cmd("SET")
            .arg(&key)
            .arg(&token)
            .arg("NX")
            .arg("PX")
            .arg(ttl.as_millis() as u64)
            .query_async(&mut connection)
            .await?;
        if acquired.is_none() {
            return Err(anyhow!("lock is already held: {key}"));
        }

        let manager = Arc::clone(self);
        let heartbeat_key = key.clone();
        let heartbeat_token = token.clone();
        let heartbeat = tokio::spawn(async move {
            loop {
                tokio::time::sleep(HEARTBEAT_INTERVAL).await;
                if manager
                    .extend(&heartbeat_key, &heartbeat_token, ttl)
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });

        Ok(LockGuard {
            manager: Arc::clone(self),
            key,
            token,
            heartbeat: Some(heartbeat),
        })
    }

    async fn extend(&self, key: &str, token: &str, ttl: Duration) -> Result<()> {
        let mut connection = self.connection().await?;
        let renewed: i32 = Script::new(EXTEND_SCRIPT)
            .key(key)
            .arg(token)
            .arg(ttl.as_millis() as u64)
            .invoke_async(&mut connection)
            .await?;
        if renewed != 1 {
            return Err(anyhow!("lock lease was lost: {key}"));
        }
        Ok(())
    }

    async fn release(&self, key: &str, token: &str) -> Result<()> {
        let mut connection = self.connection().await?;
        let released: i32 = Script::new(RELEASE_SCRIPT)
            .key(key)
            .arg(token)
            .invoke_async(&mut connection)
            .await?;
        if released != 1 {
            return Err(anyhow!("lock lease was lost: {key}"));
        }
        Ok(())
    }
}

impl LockGuard {
    pub async fn release(mut self) -> Result<()> {
        if let Some(heartbeat) = self.heartbeat.take() {
            heartbeat.abort();
        }
        self.manager.release(&self.key, &self.token).await
    }
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        if let Some(heartbeat) = self.heartbeat.take() {
            heartbeat.abort();
        }
    }
}