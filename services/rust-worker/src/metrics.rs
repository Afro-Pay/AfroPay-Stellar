use once_cell::sync::Lazy;
use prometheus::{Encoder, Histogram, HistogramOpts, IntCounter, IntGauge, Opts, Registry, TextEncoder};
use std::convert::Infallible;
use std::net::SocketAddr;
use warp::Filter;

pub static REGISTRY: Lazy<Registry> = Lazy::new(|| Registry::new());

pub static QUEUE_DEPTH: Lazy<IntGauge> = Lazy::new(|| {
    let g = IntGauge::with_opts(Opts::new("queue_depth", "Redis queue depth"))
        .expect("create gauge");
    REGISTRY.register(Box::new(g.clone())).ok();
    g
});

pub static TX_LATENCY_MS: Lazy<Histogram> = Lazy::new(|| {
    let opts = HistogramOpts::new("tx_processing_latency_ms", "Transaction processing latency in ms");
    let h = Histogram::with_opts(opts).expect("create histogram");
    REGISTRY.register(Box::new(h.clone())).ok();
    h
});

pub static TX_SUCCESS_TOTAL: Lazy<IntCounter> = Lazy::new(|| {
    let c = IntCounter::with_opts(Opts::new("tx_success_total", "Total successful transactions")).expect("create counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

pub static TX_FAILURE_TOTAL: Lazy<IntCounter> = Lazy::new(|| {
    let c = IntCounter::with_opts(Opts::new("tx_failure_total", "Total failed transactions")).expect("create counter");
    REGISTRY.register(Box::new(c.clone())).ok();
    c
});

pub async fn serve() {
    let port: u16 = std::env::var("METRICS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9898);

    let metrics_route = warp::path("metrics").and_then(metrics_handler);

    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    let server = warp::serve(metrics_route).run(addr);
    println!("Metrics server listening on http://{}", addr);
    server.await;
}

async fn metrics_handler() -> Result<impl warp::Reply, Infallible> {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
    let res = String::from_utf8(buffer).unwrap_or_default();
    Ok(res)
}
