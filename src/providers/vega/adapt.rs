use crate::providers::models::{
    CatalogItem, MediaDetails, MediaType, ProviderError, ProviderKind, ProviderMediaId, Release,
    SourceMirror,
};
use super::types::{VegaInfo, VegaPost, VegaStream};
fn normalize_provider(provider: &str) -> String {
    provider.trim().to_lowercase()
}
pub fn post_to_catalog_item(post: &VegaPost, provider: &str) -> Option<CatalogItem> {
    let title = post.title.trim();
    if title.is_empty() {
        return None;
    }
    let link = post.link.trim();
    if link.is_empty() {
        return None;
    }
    let year = extract_year(title);
    let media_type = infer_media_type(title);
    Some(CatalogItem {
        id: ProviderMediaId {
            provider: ProviderKind::Addons,
            value: format!("{}|{}", normalize_provider(provider), link),
        },
        title: title.to_string(),
        media_type,
        year,
        poster_url: post.image.clone(),
        season_count: None,
    })
}
pub fn info_to_media_details(info: &VegaInfo, provider: &str, link: &str) -> MediaDetails {
    let year = extract_year(&info.title);
    let media_type = if info
        .info_type
        .as_deref()
        .map(|t| t.eq_ignore_ascii_case("series"))
        .unwrap_or(false)
    {
        MediaType::Series
    } else {
        MediaType::Movie
    };
    let description = info.synopsis.clone();
    let duration = None;
    let genres = info.tags.clone().unwrap_or_default();
    MediaDetails {
        id: ProviderMediaId {
            provider: ProviderKind::Addons,
            value: format!("{}|{}", normalize_provider(provider), link),
        },
        title: info.title.clone(),
        media_type,
        year,
        description,
        tagline: None,
        imdb_rating: info.rating.clone(),
        director: None,
        stars: info.cast.as_ref().map(|c| c.join(", ")),
        prints: None,
        audios: None,
        poster_url: info.image.clone(),
        duration,
        genres,
        seasons: Vec::new(),
        dubs: Vec::new(),
    }
}
pub fn stream_to_release(stream: &VegaStream, quality_hint: Option<&str>) -> Option<Release> {
    let url = stream.link.trim();
    if url.is_empty() {
        return None;
    }
    let headers = extract_headers(&stream.headers);
    let quality = stream
        .quality
        .clone()
        .or_else(|| quality_hint.map(|q| q.to_string()))
        .map(|q| {
            if q.ends_with('p') {
                q
            } else {
                format!("{}p", q)
            }
        });
    let codec = None;
    let filename = stream.server.clone();
    Some(Release {
        provider: ProviderKind::Addons,
        filename,
        quality,
        codec,
        language: None,
        size_bytes: None,
        season: None,
        episode: None,
        mirrors: vec![SourceMirror {
            label: stream.server.clone(),
            resolver_url: url.to_string(),
            headers,
            direct_file: true,
        }],
        resource_id: None,
    })
}
fn extract_headers(raw: &Option<serde_json::Value>) -> Vec<(String, String)> {
    let Some(val) = raw else {
        return Vec::new();
    };
    let Some(obj) = val.as_object() else {
        return Vec::new();
    };
    obj.iter()
        .filter_map(|(k, v)| {
            v.as_str()
                .map(|s| (k.clone(), s.to_string()))
                .or_else(|| v.as_i64().map(|n| (k.clone(), n.to_string())))
                .or_else(|| v.as_u64().map(|n| (k.clone(), n.to_string())))
        })
        .collect()
}
fn extract_year(input: &str) -> Option<String> {
    input
        .as_bytes()
        .windows(4)
        .find(|w| w.iter().all(u8::is_ascii_digit) && matches!(w[0], b'1' | b'2'))
        .and_then(|w| std::str::from_utf8(w).ok())
        .map(|s| s.to_string())
}
fn infer_media_type(title: &str) -> MediaType {
    let lower = title.to_lowercase();
    if lower.contains("season")
        || lower.contains(" s01")
        || lower.contains("s01e")
        || lower.contains("complete series")
    {
        MediaType::Series
    } else {
        MediaType::Movie
    }
}
pub fn parse_provider_value(value: &str) -> Option<(String, String)> {
    let mut parts = value.splitn(2, '|');
    let provider = parts.next()?.to_string();
    let link = parts.next()?.to_string();
    if provider.is_empty() || link.is_empty() {
        return None;
    }
    Some((provider, link))
}
pub fn map_http_error(status: u16, body: &str) -> ProviderError {
    match status {
        404 => ProviderError::NotFound,
        429 => ProviderError::RateLimited(None),
        _ => ProviderError::Unavailable(format!("bridge HTTP {}: {}", status, body)),
    }
}