use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{error, warn};

const DEFAULT_MAX_BLOCK_LAG: u64 = 3;
const DEFAULT_RATE_LIMIT_COOLDOWN: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RpcEndpointKind {
    Horizon,
    Soroban,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RpcHealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    RateLimited,
}

#[derive(Clone, Debug)]
pub struct RpcEndpointConfig {
    pub id: String,
    pub url: String,
    pub kind: RpcEndpointKind,
    pub weight: f64,
}

#[derive(Clone, Debug)]
pub struct RpcEndpointState {
    pub config: RpcEndpointConfig,
    pub status: RpcHealthStatus,
    pub latency_ms: Option<u128>,
    pub block_height: Option<u64>,
    pub consecutive_failures: u32,
    pub last_error: Option<String>,
    pub rate_limited_until: Option<Instant>,
    routing_balance: f64,
}

#[derive(Clone)]
pub struct RpcPool {
    client: Client,
    endpoints: Arc<RwLock<Vec<RpcEndpointState>>>,
    max_block_lag: u64,
    rate_limit_cooldown: Duration,
}

#[derive(Debug, Error)]
pub enum RpcPoolError {
    #[error("no healthy {0:?} RPC endpoints are available")]
    NoHealthyEndpoints(RpcEndpointKind),
    #[error("all {kind:?} RPC endpoints failed: {errors}")]
    AllEndpointsFailed {
        kind: RpcEndpointKind,
        errors: String,
    },
    #[error("rpc request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("rpc response was invalid: {0}")]
    InvalidResponse(String),
}

impl RpcPool {
    pub fn new(configs: Vec<RpcEndpointConfig>) -> Self {
        let endpoints = configs
            .into_iter()
            .map(|config| RpcEndpointState {
                config,
                status: RpcHealthStatus::Degraded,
                latency_ms: None,
                block_height: None,
                consecutive_failures: 0,
                last_error: None,
                rate_limited_until: None,
                routing_balance: 0.0,
            })
            .collect();

        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .expect("reqwest client should build"),
            endpoints: Arc::new(RwLock::new(endpoints)),
            max_block_lag: DEFAULT_MAX_BLOCK_LAG,
            rate_limit_cooldown: DEFAULT_RATE_LIMIT_COOLDOWN,
        }
    }

    pub fn from_env() -> Self {
        let mut configs = parse_endpoint_env(
            "HORIZON_URLS",
            "HORIZON_URL",
            "https://horizon-testnet.stellar.org",
            RpcEndpointKind::Horizon,
        );
        configs.extend(parse_endpoint_env(
            "SOROBAN_RPC_URLS",
            "SOROBAN_RPC_URL",
            "https://soroban-testnet.stellar.org",
            RpcEndpointKind::Soroban,
        ));
        Self::new(configs)
    }

    pub async fn states(&self) -> Vec<RpcEndpointState> {
        self.endpoints.read().await.clone()
    }

    pub async fn refresh_health(&self) {
        let states = self.states().await;
        for endpoint in states {
            self.poll_endpoint(&endpoint.config).await;
        }
        self.alert_if_all_degraded(RpcEndpointKind::Horizon).await;
        self.alert_if_all_degraded(RpcEndpointKind::Soroban).await;
    }

    pub async fn horizon_get_json(&self, path: &str) -> Result<Value, RpcPoolError> {
        self.with_endpoint(RpcEndpointKind::Horizon, |client, endpoint| {
            let path = path.to_string();
            async move {
                let url = format!(
                    "{}/{}",
                    endpoint.config.url.trim_end_matches('/'),
                    path.trim_start_matches('/')
                );
                let response = client.get(url).send().await?;
                if response.status() == StatusCode::TOO_MANY_REQUESTS {
                    return Err(RpcPoolError::InvalidResponse("rate limited".into()));
                }
                if !response.status().is_success() {
                    return Err(RpcPoolError::InvalidResponse(format!(
                        "Horizon returned {}",
                        response.status()
                    )));
                }
                response.json::<Value>().await.map_err(RpcPoolError::Request)
            }
        })
        .await
    }

    pub async fn horizon_post_form(&self, path: &str, form: &[(&str, &str)]) -> Result<Value, RpcPoolError> {
        self.with_endpoint(RpcEndpointKind::Horizon, |client, endpoint| {
            let path = path.to_string();
            let form = form
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect::<Vec<_>>();
            async move {
                let url = format!(
                    "{}/{}",
                    endpoint.config.url.trim_end_matches('/'),
                    path.trim_start_matches('/')
                );
                let response = client.post(url).form(&form).send().await?;
                if response.status() == StatusCode::TOO_MANY_REQUESTS {
                    return Err(RpcPoolError::InvalidResponse("rate limited".into()));
                }
                if !response.status().is_success() {
                    let body = response.text().await.unwrap_or_default();
                    return Err(RpcPoolError::InvalidResponse(body));
                }
                response.json::<Value>().await.map_err(RpcPoolError::Request)
            }
        })
        .await
    }

    pub async fn soroban_json_rpc(&self, method: &str, params: Value) -> Result<Value, RpcPoolError> {
        self.with_endpoint(RpcEndpointKind::Soroban, |client, endpoint| {
            let method = method.to_string();
            let params = params.clone();
            async move {
                let response = client
                    .post(&endpoint.config.url)
                    .json(&json!({
                        "jsonrpc": "2.0",
                        "id": "afropay-worker",
                        "method": method,
                        "params": params,
                    }))
                    .send()
                    .await?;
                if response.status() == StatusCode::TOO_MANY_REQUESTS {
                    return Err(RpcPoolError::InvalidResponse("rate limited".into()));
                }
                if !response.status().is_success() {
                    return Err(RpcPoolError::InvalidResponse(format!(
                        "Soroban RPC returned {}",
                        response.status()
                    )));
                }
                let payload = response.json::<Value>().await?;
                if let Some(error) = payload.get("error") {
                    return Err(RpcPoolError::InvalidResponse(error.to_string()));
                }
                Ok(payload["result"].clone())
            }
        })
        .await
    }

    async fn with_endpoint<F, Fut, T>(&self, kind: RpcEndpointKind, operation: F) -> Result<T, RpcPoolError>
    where
        F: Fn(Client, RpcEndpointState) -> Fut,
        Fut: std::future::Future<Output = Result<T, RpcPoolError>>,
    {
        let candidates = self.ranked_healthy(kind.clone()).await;
        if candidates.is_empty() {
            self.alert_if_all_degraded(kind.clone()).await;
            return Err(RpcPoolError::NoHealthyEndpoints(kind));
        }

        let mut errors = Vec::new();
        for endpoint in candidates {
            let started = Instant::now();
            match operation(self.client.clone(), endpoint.clone()).await {
                Ok(value) => {
                    self.mark_success(&endpoint.config.id, started.elapsed().as_millis(), None)
                        .await;
                    return Ok(value);
                }
                Err(error) => {
                    let rate_limited = error.to_string().contains("rate limited");
                    self.mark_failure(&endpoint.config.id, error.to_string(), rate_limited)
                        .await;
                    errors.push(format!("{}: {}", endpoint.config.id, error));
                }
            }
        }

        self.alert_if_all_degraded(kind.clone()).await;
        Err(RpcPoolError::AllEndpointsFailed {
            kind,
            errors: errors.join("; "),
        })
    }

    async fn ranked_healthy(&self, kind: RpcEndpointKind) -> Vec<RpcEndpointState> {
        let mut endpoints = self.endpoints.write().await;
        let highest = endpoints
            .iter()
            .filter(|endpoint| endpoint.config.kind == kind)
            .filter_map(|endpoint| endpoint.block_height)
            .max();
        let now = Instant::now();
        let mut candidate_indexes = endpoints
            .iter()
            .enumerate()
            .filter(|(_, endpoint)| endpoint.config.kind == kind)
            .filter(|(_, endpoint)| is_routable(endpoint, highest, self.max_block_lag, now))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();

        if candidate_indexes.len() <= 1 {
            return candidate_indexes
                .into_iter()
                .map(|index| endpoints[index].clone())
                .collect();
        }

        let total_weight = candidate_indexes
            .iter()
            .map(|index| effective_weight(&endpoints[*index]))
            .sum::<f64>();

        for index in &candidate_indexes {
            endpoints[*index].routing_balance += effective_weight(&endpoints[*index]);
        }

        let selected_index = *candidate_indexes
            .iter()
            .max_by(|left, right| {
                endpoints[**left]
                    .routing_balance
                    .partial_cmp(&endpoints[**right].routing_balance)
                    .unwrap_or(Ordering::Equal)
            })
            .expect("candidate list is not empty");
        endpoints[selected_index].routing_balance -= total_weight;

        candidate_indexes.sort_by(|left, right| {
            if *left == selected_index {
                return Ordering::Less;
            }
            if *right == selected_index {
                return Ordering::Greater;
            }
            effective_weight(&endpoints[*right])
                .partial_cmp(&effective_weight(&endpoints[*left]))
                .unwrap_or(Ordering::Equal)
        });

        candidate_indexes
            .into_iter()
            .map(|index| endpoints[index].clone())
            .collect()
    }

    async fn poll_endpoint(&self, config: &RpcEndpointConfig) {
        let started = Instant::now();
        let result = match config.kind {
            RpcEndpointKind::Horizon => self.fetch_horizon_height(&config.url).await,
            RpcEndpointKind::Soroban => self.fetch_soroban_height(&config.url).await,
        };

        match result {
            Ok(height) => {
                self.mark_success(&config.id, started.elapsed().as_millis(), Some(height))
                    .await;
            }
            Err(error) => {
                let rate_limited = error.to_string().contains("429");
                self.mark_failure(&config.id, error.to_string(), rate_limited)
                    .await;
            }
        }
    }

    async fn fetch_horizon_height(&self, url: &str) -> Result<u64, RpcPoolError> {
        let response = self.client.get(url.trim_end_matches('/')).send().await?;
        if !response.status().is_success() {
            return Err(RpcPoolError::InvalidResponse(format!(
                "Horizon returned {}",
                response.status()
            )));
        }
        let payload = response.json::<Value>().await?;
        payload
            .get("history_latest_ledger")
            .or_else(|| payload.get("core_latest_ledger"))
            .and_then(Value::as_u64)
            .ok_or_else(|| RpcPoolError::InvalidResponse("Horizon height missing".into()))
    }

    async fn fetch_soroban_height(&self, url: &str) -> Result<u64, RpcPoolError> {
        let response = self
            .client
            .post(url)
            .json(&json!({"jsonrpc":"2.0","id":"health","method":"getLatestLedger"}))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(RpcPoolError::InvalidResponse(format!(
                "Soroban RPC returned {}",
                response.status()
            )));
        }
        let payload = response.json::<Value>().await?;
        payload
            .pointer("/result/sequence")
            .or_else(|| payload.pointer("/result/latestLedger"))
            .and_then(Value::as_u64)
            .ok_or_else(|| RpcPoolError::InvalidResponse("Soroban height missing".into()))
    }

    async fn mark_success(&self, id: &str, latency_ms: u128, height: Option<u64>) {
        let mut endpoints = self.endpoints.write().await;
        if let Some(endpoint) = endpoints.iter_mut().find(|endpoint| endpoint.config.id == id) {
            endpoint.status = RpcHealthStatus::Healthy;
            endpoint.latency_ms = Some(latency_ms);
            if let Some(height) = height {
                endpoint.block_height = Some(height);
            }
            endpoint.consecutive_failures = 0;
            endpoint.last_error = None;
            endpoint.rate_limited_until = None;
        }
    }

    async fn mark_failure(&self, id: &str, error: String, rate_limited: bool) {
        let mut endpoints = self.endpoints.write().await;
        if let Some(endpoint) = endpoints.iter_mut().find(|endpoint| endpoint.config.id == id) {
            endpoint.consecutive_failures += 1;
            endpoint.last_error = Some(error.clone());
            if rate_limited {
                endpoint.status = RpcHealthStatus::RateLimited;
                endpoint.rate_limited_until = Some(Instant::now() + self.rate_limit_cooldown);
            } else {
                endpoint.status = if endpoint.consecutive_failures >= 2 {
                    RpcHealthStatus::Unhealthy
                } else {
                    RpcHealthStatus::Degraded
                };
            }
            warn!(endpoint_id = %id, error = %error, "RPC endpoint marked degraded");
        }
    }

    async fn alert_if_all_degraded(&self, kind: RpcEndpointKind) {
        if self.ranked_healthy(kind.clone()).await.is_empty() {
            error!(kind = ?kind, "all RPC endpoints are degraded");
        }
    }
}

fn is_routable(
    endpoint: &RpcEndpointState,
    highest: Option<u64>,
    max_block_lag: u64,
    now: Instant,
) -> bool {
    if matches!(endpoint.status, RpcHealthStatus::Unhealthy) {
        return false;
    }
    if matches!(endpoint.status, RpcHealthStatus::RateLimited)
        && endpoint.rate_limited_until.map_or(true, |until| until > now)
    {
        return false;
    }
    if let (Some(best), Some(height)) = (highest, endpoint.block_height) {
        if best.saturating_sub(height) > max_block_lag {
            return false;
        }
    }
    matches!(endpoint.status, RpcHealthStatus::Healthy | RpcHealthStatus::Degraded)
}

fn effective_weight(endpoint: &RpcEndpointState) -> f64 {
    let latency = endpoint.latency_ms.unwrap_or(1_000).max(1) as f64;
    endpoint.config.weight * (1_000.0 / latency)
}

fn parse_endpoint_env(
    list_key: &str,
    fallback_key: &str,
    default_url: &str,
    kind: RpcEndpointKind,
) -> Vec<RpcEndpointConfig> {
    let raw = std::env::var(list_key)
        .or_else(|_| std::env::var(fallback_key))
        .unwrap_or_else(|_| default_url.to_string());

    raw.split(',')
        .filter_map(|entry| {
            let mut parts = entry.trim().split('|');
            let url = parts.next()?.trim();
            if url.is_empty() {
                return None;
            }
            let weight = parts
                .next()
                .and_then(|value| value.trim().parse::<f64>().ok())
                .filter(|value| *value > 0.0)
                .unwrap_or(1.0);
            Some(RpcEndpointConfig {
                id: format!("{:?}-{}", kind, url),
                url: url.to_string(),
                kind: kind.clone(),
                weight,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn fails_over_to_backup_horizon_node() {
        let primary_hits = Arc::new(AtomicUsize::new(0));
        let backup_hits = Arc::new(AtomicUsize::new(0));
        let primary = serve_json(primary_hits.clone(), 500, r#"{"error":"down"}"#).await;
        let backup = serve_json(backup_hits.clone(), 200, r#"{"history_latest_ledger":42}"#).await;
        let pool = RpcPool::new(vec![
            endpoint("primary", &primary, RpcEndpointKind::Horizon),
            endpoint("backup", &backup, RpcEndpointKind::Horizon),
        ]);

        pool.refresh_health().await;
        let payload = pool.horizon_get_json("/").await.expect("backup should serve");

        assert_eq!(payload["history_latest_ledger"], 42);
        assert!(primary_hits.load(AtomicOrdering::SeqCst) >= 1);
        assert!(backup_hits.load(AtomicOrdering::SeqCst) >= 1);
    }

    #[tokio::test]
    async fn posts_transactions_to_backup_when_primary_fails() {
        let primary_hits = Arc::new(AtomicUsize::new(0));
        let backup_hits = Arc::new(AtomicUsize::new(0));
        let primary = serve_json(primary_hits.clone(), 500, r#"{"error":"down"}"#).await;
        let backup = serve_json(backup_hits.clone(), 200, r#"{"hash":"abc123"}"#).await;
        let pool = RpcPool::new(vec![
            endpoint("primary", &primary, RpcEndpointKind::Horizon),
            endpoint("backup", &backup, RpcEndpointKind::Horizon),
        ]);
        pool.mark_success("primary", 10, Some(10)).await;
        pool.mark_success("backup", 10, Some(10)).await;

        let payload = pool
            .horizon_post_form("/transactions", &[("tx", "xdr")])
            .await
            .expect("backup should accept transaction");

        assert_eq!(payload["hash"], "abc123");
        assert_eq!(primary_hits.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(backup_hits.load(AtomicOrdering::SeqCst), 1);
    }

    #[tokio::test]
    async fn excludes_horizon_nodes_lagging_more_than_three_ledgers() {
        let stale_hits = Arc::new(AtomicUsize::new(0));
        let fresh_hits = Arc::new(AtomicUsize::new(0));
        let stale = serve_json(stale_hits.clone(), 200, r#"{"history_latest_ledger":96}"#).await;
        let fresh = serve_json(fresh_hits.clone(), 200, r#"{"history_latest_ledger":100}"#).await;
        let pool = RpcPool::new(vec![
            endpoint("stale", &stale, RpcEndpointKind::Horizon),
            endpoint("fresh", &fresh, RpcEndpointKind::Horizon),
        ]);

        pool.refresh_health().await;
        let payload = pool.horizon_get_json("/").await.expect("fresh node should serve");

        assert_eq!(payload["history_latest_ledger"], 100);
    }

    #[tokio::test]
    async fn marks_rate_limited_nodes_as_unroutable() {
        let rate_limited_hits = Arc::new(AtomicUsize::new(0));
        let healthy_hits = Arc::new(AtomicUsize::new(0));
        let rate_limited = serve_json(rate_limited_hits.clone(), 429, r#"{"error":"limited"}"#).await;
        let healthy = serve_json(healthy_hits.clone(), 200, r#"{"history_latest_ledger":88}"#).await;
        let pool = RpcPool::new(vec![
            endpoint("limited", &rate_limited, RpcEndpointKind::Horizon),
            endpoint("healthy", &healthy, RpcEndpointKind::Horizon),
        ]);

        pool.refresh_health().await;
        let payload = pool.horizon_get_json("/").await.expect("healthy node should serve");
        let states = pool.states().await;

        assert_eq!(payload["history_latest_ledger"], 88);
        assert_eq!(states[0].status, RpcHealthStatus::RateLimited);
    }

    #[tokio::test]
    async fn prefers_lower_latency_nodes_over_multiple_selections() {
        let pool = RpcPool::new(vec![
            endpoint("fast", "http://fast.test", RpcEndpointKind::Horizon),
            endpoint("slow", "http://slow.test", RpcEndpointKind::Horizon),
        ]);
        pool.mark_success("fast", 10, Some(10)).await;
        pool.mark_success("slow", 100, Some(10)).await;

        let mut fast = 0;
        let mut slow = 0;
        for _ in 0..10 {
            let ranked = pool.ranked_healthy(RpcEndpointKind::Horizon).await;
            match ranked.first().map(|endpoint| endpoint.config.id.as_str()) {
                Some("fast") => fast += 1,
                Some("slow") => slow += 1,
                other => panic!("unexpected selected endpoint: {:?}", other),
            }
        }

        assert!(fast > slow, "fast endpoint should win more often");
    }

    fn endpoint(id: &str, url: &str, kind: RpcEndpointKind) -> RpcEndpointConfig {
        RpcEndpointConfig {
            id: id.to_string(),
            url: url.to_string(),
            kind,
            weight: 1.0,
        }
    }

    async fn serve_json(hits: Arc<AtomicUsize>, status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock server");
        let addr = listener.local_addr().expect("mock server addr");
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.expect("accept mock request");
                hits.fetch_add(1, AtomicOrdering::SeqCst);
                let mut buffer = [0_u8; 2048];
                let _ = socket.read(&mut buffer).await;
                let response = format!(
                    "HTTP/1.1 {} OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    status,
                    body.len(),
                    body
                );
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });
        format!("http://{}", addr)
    }
}
