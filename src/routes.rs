use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::api_types::{DetailsResponse, SearchResponse, StreamsResponse};
use crate::providers::{Provider, ReleaseProvider};
use crate::state::AppState;
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/search", get(search))
        .route("/details", get(details))
        .route("/streams", get(streams))
        .route("/providers", get(providers))
        .with_state(state)
}
#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    #[serde(default)]
    page: Option<usize>,
}
async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, Json<Value>)> {
    let page = params.page.unwrap_or(1);
    let results = Provider::search(&*state.moviebox, &params.q, page)
        .await
        .map_err(internal)?;
    Ok(Json(SearchResponse {
        query: params.q,
        page,
        results: results.into_iter().map(Into::into).collect(),
    }))
}
#[derive(Deserialize)]
struct DetailsQuery {
    id: String,
}
async fn details(
    State(state): State<AppState>,
    Query(params): Query<DetailsQuery>,
) -> Result<Json<DetailsResponse>, (StatusCode, Json<Value>)> {
    let details = Provider::details(&*state.moviebox, &params.id)
        .await
        .map_err(internal)?;
    Ok(Json(details.into()))
}
#[derive(Deserialize)]
struct StreamsQuery {
    id: String,
    #[serde(default)]
    season: usize,
    #[serde(default)]
    episode: usize,
}
async fn streams(
    State(state): State<AppState>,
    Query(params): Query<StreamsQuery>,
) -> Result<Json<StreamsResponse>, (StatusCode, Json<Value>)> {
    let releases = ReleaseProvider::episode_streams(
        &*state.moviebox,
        &params.id,
        params.season,
        params.episode,
    )
    .await
    .map_err(internal)?;
    Ok(Json(StreamsResponse {
        id: params.id,
        provider: "moviebox".to_string(),
        streams: releases.into_iter().map(Into::into).collect(),
    }))
}
async fn providers() -> Json<Value> {
    Json(json!({
        "providers": ["moviebox"],
    }))
}
fn internal(err: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": err.to_string() })),
    )
}
