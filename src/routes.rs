use axum::body::Body;
use axum::response::Response;
use axum::http::header;
use tokio::process::Command;
use tokio_stream::wrappers::ReceiverStream;
use std::process::Stdio;
use tokio::io::AsyncBufReadExt;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::api_types::{DetailsResponse, SearchResponse, StreamsResponse};
use crate::providers::ProviderKind;
use crate::state::AppState;
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/search", get(search))
        .route("/details", get(details))
        .route("/streams", get(streams))
        .route("/providers", get(providers))
        .route("/download", get(download))
        .route("/debug-raw", get(debug_raw))
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
    let results = state
        .media
        .search_merged(&params.q, page)
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
    #[serde(default)]
    provider: Option<String>,
}
async fn details(
    State(state): State<AppState>,
    Query(params): Query<DetailsQuery>,
) -> Result<Json<DetailsResponse>, (StatusCode, Json<Value>)> {
    let provider = params
        .provider
        .as_deref()
        .and_then(ProviderKind::parse)
        .unwrap_or(ProviderKind::MovieBox);
    let details = state
        .media
        .details_typed(provider, &params.id)
        .await
        .map_err(internal)?;
    Ok(Json(details.into()))
}
#[derive(Deserialize)]
struct StreamsQuery {
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    season: usize,
    #[serde(default)]
    episode: usize,
    #[serde(default)]
    audio: Option<String>,
    #[serde(default)]
    max_height: Option<u32>,
}
async fn streams(
    State(state): State<AppState>,
    Query(params): Query<StreamsQuery>,
) -> Result<Json<StreamsResponse>, (StatusCode, Json<Value>)> {
    let effective_id = params.id.as_str();
    let title = params.title.clone().unwrap_or_default();
    let releases = state
        .media
        .streams_with_fallback(effective_id, &title, params.season, params.episode)
        .await
        .map_err(internal)?;
    let filtered = filter_by_max_height(releases, params.max_height);
    Ok(Json(StreamsResponse {
        id: params.id,
        provider: "auto".to_string(),
        streams: filtered.into_iter().map(Into::into).collect(),
    }))
}
fn filter_by_max_height(
    releases: Vec<crate::providers::Release>,
    max_height: Option<u32>,
) -> Vec<crate::providers::Release> {
    let Some(max_h) = max_height else {
        return releases;
    };
    if releases.is_empty() {
        return releases;
    }
    let mut with_res: Vec<(u64, crate::providers::Release)> = releases
        .into_iter()
        .map(|r| (r.resolution_u64(), r))
        .collect();
    with_res.sort_by_key(|(r, _)| *r);
    if let Some((_, exact)) = with_res.iter().find(|(r, _)| *r == max_h as u64) {
        return vec![exact.clone()];
    }
    if let Some((_, lower)) = with_res
        .iter()
        .rev()
        .find(|(r, _)| *r < max_h as u64)
    {
        return vec![lower.clone()];
    }
    if let Some((_, higher)) = with_res.iter().find(|(r, _)| *r > max_h as u64) {
        return vec![higher.clone()];
    }
    with_res.into_iter().map(|(_, r)| r).collect()
}
async fn providers() -> Json<Value> {
    Json(json!({
        "providers": ["moviebox", "fourkhdhub"],
    }))
}
#[derive(Deserialize)]
struct DebugRawQuery {
    id: String,
}
async fn debug_raw(
    State(state): State<AppState>,
    Query(params): Query<DebugRawQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let json = state
        .media
        .moviebox
        .get_details(&params.id)
        .await
        .map_err(internal)?;
    Ok(Json(json))
}#[derive(Deserialize)]
struct DownloadQuery {
    id: String,
    #[serde(default)]
    season: usize,
    #[serde(default)]
    episode: usize,
    #[serde(default)]
    audio: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    max_height: Option<u32>,
}
async fn download(
    State(state): State<AppState>,
    Query(params): Query<DownloadQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let effective_id = params.id.as_str();
    let title = params.title.clone().unwrap_or_else(|| params.id.clone());
    let releases = state
        .media
        .streams_with_fallback(effective_id, &title, params.season, params.episode)
        .await
        .map_err(internal)?;
    let filtered = filter_by_max_height(releases, params.max_height);
    let target = filtered.first().ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "No stream available" })),
        )
    })?;
    let url = target
        .direct_url()
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "No direct URL" })),
            )
        })?
        .to_string();
    let headers = target
        .mirrors
        .first()
        .map(|m| m.headers.clone())
        .unwrap_or_default();
    let safe_title = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
        .trim()
        .to_string();
    let mut cmd = Command::new("yt-dlp");
    cmd.arg("-f").arg("bv*+ba/b");
    cmd.arg("--no-playlist");
    cmd.arg("--no-warnings");
    cmd.arg("--quiet");
    cmd.arg("-o").arg("-");
    cmd.arg("--merge-output-format").arg("mp4");
    for (name, value) in &headers {
        cmd.arg("--add-header").arg(format!("{}:{}", name, value));
    }
    cmd.arg(&url);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to spawn yt-dlp: {}", e) })),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to capture stdout" })),
        )
    })?;
    // Drain stderr in the background so the process does not block
    if let Some(mut stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(&mut stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                tracing::debug!("yt-dlp: {}", line);
            }
        });
    }
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(16);
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut buf = vec![0u8; 64 * 1024];
        use tokio::io::AsyncReadExt;
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = axum::body::Bytes::copy_from_slice(&buf[..n]);
                    if tx.send(Ok(chunk)).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    break;
                }
            }
        }
        let _ = child.wait().await;
    });
    let body = Body::from_stream(ReceiverStream::new(rx));
    let filename = format!("{}.mp4", safe_title);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(body)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    Ok(response)
}fn internal(err: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": err.to_string() })),
    )
}