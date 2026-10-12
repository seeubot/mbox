pub mod adapt;
pub mod types;
use crate::providers::models::{
    CatalogItem, MediaDetails, ProviderError, ProviderKind, Release,
};
use crate::providers::{Provider, ProviderCapabilities, ReleaseProvider};
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;
use types::{VegaCatalog, VegaEpisodeLink, VegaInfo, VegaPost, VegaProvider, VegaStream};
const DEFAULT_BRIDGE_URL: &str = "http://127.0.0.1:3002";
const REQUEST_TIMEOUT_SECS: u64 = 30;
#[derive(Clone)]
pub struct VegaBridgeClient {
    client: Client,
    base_url: String,
}
impl VegaBridgeClient {
    pub fn new() -> Self {
        Self::with_url(
            std::env::var("NODE_BRIDGE_URL")
                .unwrap_or_else(|_| DEFAULT_BRIDGE_URL.to_string()),
        )
    }
    pub fn with_url(base_url: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client, base_url }
    }
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, ProviderError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ProviderError::Network(format!("bridge: {}", e)))?;
        let status = resp.status().as_u16();
        let body = resp
            .text()
            .await
            .map_err(|e| ProviderError::Network(format!("bridge body: {}", e)))?;
        if !(200..300).contains(&(status as i32)) {
            return Err(adapt::map_http_error(status, &body));
        }
        serde_json::from_str::<T>(&body)
            .map_err(|e| ProviderError::Parsing(format!("bridge json: {} (body: {})", e, &body[..body.len().min(200)])))
    }
    pub async fn list_providers(&self) -> Result<Vec<VegaProvider>, ProviderError> {
        self.get_json("/api/providers").await
    }
    pub async fn catalog(&self, provider: &str) -> Result<Vec<VegaCatalog>, ProviderError> {
        self.get_json(&format!("/api/catalog?provider={}", urlencode(provider)))
            .await
    }
    pub async fn posts(
        &self,
        provider: &str,
        filter: &str,
        page: u32,
    ) -> Result<Vec<VegaPost>, ProviderError> {
        let path = format!(
            "/api/posts?provider={}&filter={}&page={}",
            urlencode(provider),
            urlencode(filter),
            page
        );
        self.get_json(&path).await
    }
    pub async fn search(
        &self,
        provider: &str,
        query: &str,
        page: u32,
    ) -> Result<Vec<VegaPost>, ProviderError> {
        let path = format!(
            "/api/search?provider={}&query={}&page={}",
            urlencode(provider),
            urlencode(query),
            page
        );
        self.get_json(&path).await
    }
    pub async fn meta(&self, provider: &str, link: &str) -> Result<VegaInfo, ProviderError> {
        let path = format!(
            "/api/meta?provider={}&link={}",
            urlencode(provider),
            urlencode(link)
        );
        self.get_json(&path).await
    }
    pub async fn episodes(
        &self,
        provider: &str,
        url: &str,
    ) -> Result<Vec<VegaEpisodeLink>, ProviderError> {
        let path = format!(
            "/api/episodes?provider={}&url={}",
            urlencode(provider),
            urlencode(url)
        );
        self.get_json(&path).await
    }
    pub async fn stream(
        &self,
        provider: &str,
        link: &str,
        media_type: &str,
    ) -> Result<Vec<VegaStream>, ProviderError> {
        let path = format!(
            "/api/stream?provider={}&link={}&type={}",
            urlencode(provider),
            urlencode(link),
            urlencode(media_type)
        );
        self.get_json(&path).await
    }
}
impl Default for VegaBridgeClient {
    fn default() -> Self {
        Self::new()
    }
}
fn urlencode(s: &str) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}
impl Provider for VegaBridgeClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::Addons
    }
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: true,
            supports_series: true,
            supports_subtitles: false,
            supports_homepage: false,
        }
    }
    async fn search(&self, query: &str, page: usize) -> Result<Vec<CatalogItem>, ProviderError> {
        let providers = ["kmmovies", "flixhq", "hianime", "kisskh"];
        let mut all: Vec<CatalogItem> = Vec::new();
        for provider in &providers {
            match self.search(provider, query, page as u32).await {
                Ok(posts) => {
                    for post in posts {
                        if let Some(item) = adapt::post_to_catalog_item(&post, provider) {
                            all.push(item);
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("vega search provider {} failed: {}", provider, e);
                }
            }
        }
        Ok(all)
    }
    async fn details(&self, id: &str) -> Result<MediaDetails, ProviderError> {
        let (provider, link) = adapt::parse_provider_value(id)
            .ok_or_else(|| ProviderError::Parsing("vega id format: <provider>|<link>".into()))?;
        let info = self.meta(&provider, &link).await?;
        Ok(adapt::info_to_media_details(&info, &provider, &link))
    }
}
impl ReleaseProvider for VegaBridgeClient {
    async fn episode_streams(
        &self,
        id: &str,
        _season: usize,
        _episode: usize,
        _audio_subject_id: Option<&str>,
    ) -> Result<Vec<Release>, ProviderError> {
        let (provider, link) = adapt::parse_provider_value(id)
            .ok_or_else(|| ProviderError::Parsing("vega id format: <provider>|<link>".into()))?;
        let streams = self.stream(&provider, &link, "movie").await?;
        let mut releases = Vec::new();
        for s in &streams {
            if let Some(rel) = adapt::stream_to_release(s, None) {
                releases.push(rel);
            }
        }
        if releases.is_empty() {
            return Err(ProviderError::NotFound);
        }
        Ok(releases)
    }
}