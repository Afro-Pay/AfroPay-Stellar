use once_cell::sync::Lazy;
use prometheus::{
    CounterVec, Encoder, Gauge, GaugeVec, Histogram, HistogramOpts, HistogramVec,
    IntCounterVec, Opts, Registry, TextEncoder,
};
use std::convert::Infallible;
use std::net::SocketAddr;
use warp::Filter;

pub static REGISTRY: Lazy<Registry> = Lazy::new(Registry::new);

pub static REGISTRY: Lazy<Registry> = Lazy::new(Registry::new);

// ---------------------------------------------------------------------------
// Queue metrics
// ---------------------------------------------------------------------------

/// Current depth of the Redis stellar_jobs queue.
/// Label `queue` allows future queues to share this metric.
pub static QUEUE_DEPTH: Lazy<GaugeVec> = Lazy::new(|| {
    let g = GaugeVec::new(
        Opts::new("afropay_worker_queue_depth", "Number of jobs waiting in the Redis queue")
            .namespace(""),
        &["queue"],
    )
    .expect("create afropay_worker_queue_depth gauge");
    REGISTRY.register(Box::new(g.clone())).ok();
    g
});

/// Convenience: set the depth for the default stellar_jobs queue.
pub fn set_queue_depth(depth: i64) {
    QUEUE_DEPTH.with_label_values(&["stellar_jobs"]).set(depth as f64);
}

// ---------------------------------------------------------------------------
// Transaction processing metrics
// ---------------------------------------------------------------------------

/// Stellar transaction submission latency (end-to-end, including signing).
/// Buckets cover the full range from sub-second to 30 s (Horizon timeout).
pub static TX_LATENCY_SECONDS: Lazy<Histogram> = Lazy::new(|| {
    let opts = HistogramOpts::new(
        "afropay_worker_tx_latency_seconds",
        "End-to-end Stellar transaction submission latency in seconds",
    )
    .buckets(vec![
        0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0,
    ]);
    let h = Histogram::with_opts(opts).expect("create afropay_worker_tx_latency_seconds histogram");
    REGISTRY.register(Box::new(h.clone())).ok();
    h
});

/// Total successful Stellar submissions.
pub static TX_SUCCESS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let c = IntCounterVec::new(
        Opts::new(
            "afropay_worker_tx_success_total",
            "Total number of Stellar transactions submitted successfully",
        ),
        &["asset_code"],
    )
    .expect("create afropay_worker_tx_success_total counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

/// Total failed Stellar submissions, partitioned by error type.
/// `error_type` values: "horizon_error", "signing_error", "queue_parse_error",
///                      "connection_error", "timeout", "unknown".
pub static TX_FAILURE_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    let c = IntCounterVec::new(
        Opts::new(
            "afropay_worker_tx_failure_total",
            "Total number of Stellar transaction submission failures",
        ),
        &["error_type"],
    )
    .expect("create afropay_worker_tx_failure_total counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

pub static SSE_EVENTS_TOTAL: Lazy<IntCounter> = Lazy::new(|| {
    let c = IntCounter::with_opts(Opts::new("sse_events_total", "Total SSE events received from Horizon")).expect("create counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

pub static SSE_STATUS_UPDATES_TOTAL: Lazy<IntCounter> = Lazy::new(|| {
    let c = IntCounter::with_opts(Opts::new("sse_status_updates_total", "Total status updates via SSE")).expect("create counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

pub static SSE_ERRORS_TOTAL: Lazy<IntCounter> = Lazy::new(|| {
    let c = IntCounter::with_opts(Opts::new("sse_errors_total", "Total SSE processing errors")).expect("create counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

#[allow(dead_code)]
pub async fn serve() {
    let port: u16 = std::env::var("METRICS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9898);

    let metrics_route = warp::path("metrics").and_then(metrics_handler);
    let health_route = warp::path("health").map(|| "ok");
    let routes = metrics_route.or(health_route);

    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    println!(
        "📊 Metrics server listening on http://{}/metrics",
        addr
    );
    warp::serve(routes).run(addr).await;
}

async fn metrics_handler() -> Result<impl warp::Reply, Infallible> {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    encoder
        .encode(&metric_families, &mut buffer)
        .unwrap_or_default();
    let body = String::from_utf8(buffer).unwrap_or_default();
    Ok(warp::reply::with_header(
        body,
        "Content-Type",
        "text/plain; version=0.0.4; charset=utf-8",
    ))
}
