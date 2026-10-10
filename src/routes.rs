use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
pub fn router() -> Router {
    Router::new()
        .route("/search", get(search))
        .route("/homepage", get(homepage))
        .route("/details", get(details))
        .route("/providers", get(providers))
}
#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    page: Option<usize>,
}
async fn search(Query(params): Query<SearchQuery>) -> Json<Value> {
    Json(json!({
        "query": params.q,
        "provider": params.provider.unwrap_or_else(|| "moviebox".to_string()),
        "page": params.page.unwrap_or(1),
        "results": [],
        "status": "stub",
    }))
}
async fn homepage() -> Json<Value> {
    Json(json!({
        "tab": "trending",
        "items": [],
        "status": "stub",
    }))
}
#[derive(Deserialize)]
struct DetailsQuery {
    provider: String,
    id: String,
}
async fn details(Query(params): Query<DetailsQuery>) -> Json<Value> {
    Json(json!({
        "provider": params.provider,
        "id": params.id,
        "title": null,
        "status": "stub",
    }))
}
async fn providers() -> Json<Value> {
    Json(json!({
        "providers": ["moviebox", "fourkhdhub", "dramachi"],
        "status": "stub",
    }))
}
