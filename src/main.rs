use axum::{routing::get, Router, Json};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
mod api_types;
mod cache;
mod config;
mod logging;
mod models;
mod net;
mod providers;
mod routes;
mod service;
mod state;
#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let app_state = state::AppState::new();
    let app = Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .nest("/api", routes::router(app_state))
        .layer(cors)
        .layer(TraceLayer::new_for_http());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on {}", addr);
    tokio::spawn(probe_bridge());
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
async fn probe_bridge() {
    let url = std::env::var("NODE_BRIDGE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());
    let probe_url = format!("{}/api/providers", url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    for attempt in 1..=10 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        match client.get(&probe_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let count = resp
                    .json::<Value>()
                    .await
                    .ok()
                    .and_then(|v| v.as_array().map(|a| a.len()))
                    .unwrap_or(0);
                tracing::info!(
                    "node bridge reachable at {} ({} providers), attempt {}",
                    url,
                    count,
                    attempt
                );
                return;
            }
            Ok(resp) => {
                tracing::warn!(
                    "node bridge returned {} on attempt {}",
                    resp.status(),
                    attempt
                );
            }
            Err(e) => {
                if attempt == 10 {
                    tracing::error!(
                        "node bridge unreachable at {} after 10 attempts: {}",
                        url,
                        e
                    );
                }
            }
        }
    }
}
async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "mbox",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
