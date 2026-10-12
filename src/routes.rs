use axum::body::Body;
use axum::response::Response;
use axum::http::header;
use tokio::process::Command;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Stdio;
use uuid::Uuid;
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
        .route("/download-info", get(download_info))
        .route("/debug-raw", get(debug_raw))
        .route("/debug-env", get(debug_env))
        .route("/debug-bridge", get(debug_bridge))
        .route("/vega/providers", get(vega_providers))
        .route("/vega/catalog", get(vega_catalog))
        .route("/vega/posts", get(vega_posts))
        .route("/vega/search", get(vega_search))
        .route("/vega/details", get(vega_details))
        .route("/vega/stream", get(vega_stream))
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
        .streams_with_fallback(
            effective_id,
            &title,
            params.season,
            params.episode,
            params.audio.as_deref(),
        )
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
}
async fn debug_env() -> Json<Value> {
    let yt_path = Command::new("which").arg("yt-dlp").output().await.ok();
    let ff_path = Command::new("which").arg("ffmpeg").output().await.ok();
    let yt_ver = Command::new("yt-dlp").arg("--version").output().await.ok();
    let ff_ver = Command::new("ffmpeg").arg("-version").output().await.ok();
    let extract = |o: Option<std::process::Output>| -> Option<String> {
        o.and_then(|out| {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if !stdout.is_empty() {
                Some(stdout)
            } else if !stderr.is_empty() {
                Some(stderr.lines().next().unwrap_or("").to_string())
            } else {
                None
            }
        })
    };
    Json(json!({
        "yt_dlp_path": extract(yt_path),
        "ffmpeg_path": extract(ff_path),
        "yt_dlp_version": extract(yt_ver),
        "ffmpeg_version": extract(ff_ver),
    }))
}
#[derive(Deserialize)]
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
        .streams_with_fallback(
            effective_id,
            &title,
            params.season,
            params.episode,
            params.audio.as_deref(),
        )
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
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string();
    let tmp_dir = std::env::temp_dir();
    let tmp_path = tmp_dir.join(format!("maya_dl_{}.mp4", Uuid::new_v4()));
    tracing::info!(
        "download start: url={} tmp={}",
        crate::logging::sanitize_url(&url),
        tmp_path.display()
    );
    let mut cmd = Command::new("yt-dlp");
    cmd.arg("-f").arg("bv*+ba/b");
    cmd.arg("--no-playlist");
    cmd.arg("--no-warnings");
    cmd.arg("--no-part");
    cmd.arg("--merge-output-format").arg("mp4");
    cmd.arg("-o").arg(&tmp_path);
    for (name, value) in &headers {
        cmd.arg("--add-header").arg(format!("{}:{}", name, value));
    }
    cmd.arg(&url);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());
    let output = cmd.output().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("yt-dlp spawn failed: {}", e) })),
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .lines()
            .filter(|l| !l.trim().is_empty())
            .rev()
            .take(15)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        tracing::error!("yt-dlp failed: {}", tail);
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": "yt-dlp failed",
                "exit_code": output.status.code(),
                "stderr": tail,
            })),
        ));
    }
    let meta = tokio::fs::metadata(&tmp_path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("file not found after download: {}", e) })),
        )
    })?;
    let size = meta.len();
    if size == 0 {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": "yt-dlp produced an empty file",
                "stderr": stderr.lines().take(15).collect::<Vec<_>>().join("\n"),
            })),
        ));
    }
    tracing::info!("download complete: {} bytes", size);
    let file = tokio::fs::File::open(&tmp_path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("file open failed: {}", e) })),
        )
    })?;
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = Body::from_stream(stream);
    let filename = format!("{}.mp4", safe_title);
    let cleanup_path = tmp_path.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(120)).await;
        let _ = tokio::fs::remove_file(&cleanup_path).await;
    });
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::CONTENT_LENGTH, size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
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
}
async fn download_info(
    State(state): State<AppState>,
    Query(params): Query<DownloadQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let effective_id = params.id.as_str();
    let title = params.title.clone().unwrap_or_else(|| params.id.clone());
    let releases = state
        .media
        .streams_with_fallback(
            effective_id,
            &title,
            params.season,
            params.episode,
            params.audio.as_deref(),
        )
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
    let is_direct_mp4 = url.contains(".mp4");
    let headers_json: serde_json::Map<String, Value> = target
        .mirrors
        .first()
        .map(|m| {
            m.headers
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(json!({
        "id": params.id,
        "type": if is_direct_mp4 { "direct" } else { "proxy" },
        "url": url,
        "headers": Value::Object(headers_json),
        "size_bytes": target.size_bytes,
        "quality": target.quality,
        "codec": target.codec,
        "filename": target.filename,
        "season": params.season,
        "episode": params.episode,
        "source_label": target.source_label(),
    })))
}

async fn debug_bridge() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let url = std::env::var("NODE_BRIDGE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());
    let probe_url = format!("{}/api/providers", url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;
    let resp = client.get(&probe_url).send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("bridge unreachable: {}", e), "url": probe_url })),
        )
    })?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("invalid json from bridge: {}", e) })),
        )
    })?;
    Ok(Json(json!({
        "bridge_url": url,
        "status": status.as_u16(),
        "response": body,
    })))
}
#[derive(Deserialize)]
struct VegaProviderQuery {
    provider: String,
}
#[derive(Deserialize)]
struct VegaPostsQuery {
    provider: String,
    #[serde(default)]
    filter: String,
    #[serde(default)]
    page: Option<u32>,
}
#[derive(Deserialize)]
struct VegaSearchQuery {
    provider: String,
    q: String,
    #[serde(default)]
    page: Option<u32>,
}
#[derive(Deserialize)]
struct VegaDetailsQuery {
    provider: String,
    link: String,
}
#[derive(Deserialize)]
struct VegaStreamQuery {
    provider: String,
    link: String,
    #[serde(default)]
    r#type: Option<String>,
}
fn vega_client() -> crate::providers::vega::VegaBridgeClient {
    crate::providers::vega::VegaBridgeClient::new()
}
async fn vega_providers() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let client = vega_client();
    let providers = client.list_providers().await.map_err(internal)?;
    Ok(Json(json!({ "providers": providers })))
}
async fn vega_catalog(
    Query(params): Query<VegaProviderQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let client = vega_client();
    let catalog = client.catalog(&params.provider).await.map_err(internal)?;
    Ok(Json(json!({ "provider": params.provider, "catalog": catalog })))
}
async fn vega_posts(
    Query(params): Query<VegaPostsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let client = vega_client();
    let page = params.page.unwrap_or(1);
    let posts = client
        .posts(&params.provider, &params.filter, page)
        .await
        .map_err(internal)?;
    Ok(Json(json!({
        "provider": params.provider,
        "filter": params.filter,
        "page": page,
        "posts": posts,
    })))
}
async fn vega_search(
    Query(params): Query<VegaSearchQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let client = vega_client();
    let page = params.page.unwrap_or(1);
    let posts = client
        .search(&params.provider, &params.q, page)
        .await
        .map_err(internal)?;
    Ok(Json(json!({
        "provider": params.provider,
        "query": params.q,
        "page": page,
        "posts": posts,
    })))
}
async fn vega_details(
    Query(params): Query<VegaDetailsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let client = vega_client();
    let info = client
        .meta(&params.provider, &params.link)
        .await
        .map_err(internal)?;
    Ok(Json(json!({ "provider": params.provider, "link": params.link, "info": info })))
}
async fn vega_stream(
    Query(params): Query<VegaStreamQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let client = vega_client();
    let media_type = params.r#type.as_deref().unwrap_or("movie");
    let streams = client
        .stream(&params.provider, &params.link, media_type)
        .await
        .map_err(internal)?;
    Ok(Json(json!({
        "provider": params.provider,
        "link": params.link,
        "streams": streams,
    })))
}
fn internal(err: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": err.to_string() })),
    )
}
