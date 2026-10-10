use serde::{Deserialize, Serialize};
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct BrowseMetrics {
    pub trending: Option<f64>,
    pub rating: Option<f64>,
    pub recent_rating: Option<f64>,
    pub popularity: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub stype: i64,
    pub release_year: String,
    pub cover_url: Option<String>,
    pub season: usize,
    pub episode: usize,
    pub provider: crate::providers::models::ProviderKind,
}
