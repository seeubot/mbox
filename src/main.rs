use axum::{routing::get, Router, Json};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;
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
    let app_state = state::AppState::new();
    let app = Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .nest("/api", routes::router(app_state))
        .layer(TraceLayer::new_for_http());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "mbox",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
