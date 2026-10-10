use std::time::Duration;
use tokio::time::timeout;
use crate::models::BrowseMetrics;
use crate::providers::fourkhdhub::FourKHdHubClient;
use crate::providers::models::{
    CatalogItem, MediaDetails, ProviderError, ProviderKind, Release,
};
use crate::providers::moviebox::client::MovieBoxClient;
use crate::providers::{Provider, ReleaseProvider};
pub struct MediaService {
    pub moviebox: MovieBoxClient,
    pub fourk: Option<FourKHdHubClient>,
}
impl MediaService {
    pub fn new() -> Self {
        Self {
            moviebox: MovieBoxClient::new(),
            fourk: FourKHdHubClient::new().ok(),
        }
    }
    pub async fn search_merged(
        &self,
        query: &str,
        page: usize,
    ) -> Result<Vec<CatalogItem>, ProviderError> {
        let moviebox_fut = Provider::search(&self.moviebox, query, page);
        let fourk_fut = async {
            match self.fourk.as_ref() {
                Some(client) => Provider::search(client, query, page).await,
                None => Err(ProviderError::Unavailable("4KHDHub unavailable".into())),
            }
        };
        let (mb_res, fk_res) = tokio::join!(moviebox_fut, fourk_fut);
        let mut merged: Vec<CatalogItem> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut push_all = |items: Vec<CatalogItem>| {
            for item in items {
                let key = format!(
                    "{}|{}|{:?}",
                    item.title.trim().to_lowercase(),
                    item.year.clone().unwrap_or_default(),
                    item.media_type
                );
                if seen.insert(key) {
                    merged.push(item);
                }
            }
        };
        if let Ok(items) = mb_res {
            push_all(items);
        }
        if let Ok(items) = fk_res {
            push_all(items);
        }
        if merged.is_empty() {
            return Err(ProviderError::NotFound);
        }
        Ok(merged)
    }
    pub async fn details_typed(
        &self,
        provider: ProviderKind,
        id: &str,
    ) -> Result<MediaDetails, ProviderError> {
        match provider {
            ProviderKind::MovieBox => Provider::details(&self.moviebox, id).await,
            ProviderKind::FourKHdHub => {
                let client = self.fourk.as_ref().ok_or_else(|| {
                    ProviderError::Unavailable("4KHDHub unavailable".into())
                })?;
                Provider::details(client, id).await
            }
            other => Err(ProviderError::Unavailable(format!(
                "Provider {} not supported",
                other.label()
            ))),
        }
    }
    pub async fn streams_with_fallback(
        &self,
        moviebox_id: &str,
        title: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, ProviderError> {
        let mb_result = timeout(
            Duration::from_secs(5),
            ReleaseProvider::episode_streams(&self.moviebox, moviebox_id, season, episode),
        )
        .await;
        match mb_result {
            Ok(Ok(releases)) if !releases.is_empty() => return Ok(releases),
            Ok(Ok(_)) => {}
            Ok(Err(_)) => {}
            Err(_) => {}
        }
        let Some(fourk) = self.fourk.as_ref() else {
            return Err(ProviderError::Unavailable("4KHDHub unavailable".into()));
        };
        let results = Provider::search(fourk, title, 1).await?;
        let match_item = results.into_iter().find(|item| {
            item.title.trim().eq_ignore_ascii_case(title.trim())
        });
        let Some(item) = match_item else {
            return Err(ProviderError::NotFound);
        };
        ReleaseProvider::episode_streams(fourk, &item.id.value, season, episode).await
    }
}
impl Default for MediaService {
    fn default() -> Self {
        Self::new()
    }
}
pub fn extract_browse_metrics(item: &serde_json::Value) -> BrowseMetrics {
    let get = |keys: &[&str]| -> Option<f64> {
        for key in keys {
            if let Some(v) = item.get(*key) {
                if let Some(n) = v.as_f64() {
                    return Some(n);
                }
                if let Some(n) = v.as_i64() {
                    return Some(n as f64);
                }
                if let Some(s) = v.as_str() {
                    if let Ok(n) = s.parse::<f64>() {
                        return Some(n);
                    }
                }
            }
        }
        None
    };
    BrowseMetrics {
        trending: get(&["__browse_rank", "imdb_trending", "imdbTrending", "trending"]),
        rating: get(&["imdbRatingValue", "imdbRate", "imdb_rating", "imdbRating"]),
        recent_rating: get(&[
            "imdb_rating_30d",
            "imdbRating30Days",
            "imdbRatingLast30Days",
            "imdb_rating_recent",
            "imdbRatingValue",
            "imdbRate",
        ]),
        popularity: get(&[
            "__browse_rank",
            "imdb_popularity",
            "imdbPopularity",
            "popularity",
            "viewers",
        ]),
    }
}