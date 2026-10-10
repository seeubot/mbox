use crate::providers::{CatalogItem, MediaDetails, Release};
use serde::Serialize;
#[derive(Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub page: usize,
    pub results: Vec<SearchResultItem>,
}
#[derive(Serialize)]
pub struct SearchResultItem {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub year: Option<String>,
    pub media_type: String,
    pub poster_url: Option<String>,
}
impl From<CatalogItem> for SearchResultItem {
    fn from(item: CatalogItem) -> Self {
        Self {
            id: item.id.value,
            provider: item.id.provider.cache_key().to_string(),
            title: item.title,
            year: item.year,
            media_type: format!("{:?}", item.media_type).to_lowercase(),
            poster_url: item.poster_url,
        }
    }
}
#[derive(Serialize)]
pub struct DetailsResponse {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub year: Option<String>,
    pub media_type: String,
    pub poster_url: Option<String>,
    pub description: Option<String>,
    pub duration: Option<String>,
    pub genres: Vec<String>,
    pub imdb_rating: Option<String>,
    pub audio_tracks: Vec<AudioTrack>,
}
#[derive(Serialize)]
pub struct AudioTrack {
    pub language: String,
    pub subject_id: String,
}
impl From<MediaDetails> for DetailsResponse {
    fn from(d: MediaDetails) -> Self {
        Self {
            id: d.id.value,
            provider: d.id.provider.cache_key().to_string(),
            title: d.title,
            year: d.year,
            media_type: format!("{:?}", d.media_type).to_lowercase(),
            poster_url: d.poster_url,
            description: d.description,
            duration: d.duration,
            genres: d.genres,
            imdb_rating: d.imdb_rating,
            audio_tracks: d
                .dubs
                .into_iter()
                .map(|dub| AudioTrack {
                    language: dub.label,
                    subject_id: dub.subject_id,
                })
                .collect(),
        }
    }
}
#[derive(Serialize)]
pub struct StreamsResponse {
    pub id: String,
    pub provider: String,
    pub streams: Vec<StreamItem>,
}
#[derive(Serialize)]
pub struct StreamItem {
    pub quality: Option<String>,
    pub codec: Option<String>,
    pub language: Option<String>,
    pub size_bytes: Option<u64>,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub source_label: String,
}
impl From<Release> for StreamItem {
    fn from(r: Release) -> Self {
        let url = r
            .mirrors
            .first()
            .map(|m| m.resolver_url.clone())
            .unwrap_or_default();
        let headers = r
            .mirrors
            .first()
            .map(|m| m.headers.clone())
            .unwrap_or_default();
        Self {
            quality: r.quality,
            codec: r.codec,
            language: r.language,
            size_bytes: r.size_bytes,
            url,
            headers,
            source_label: r.source_label().to_string(),
        }
    }
}
