use serde::{Deserialize, Serialize};
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct BrowseMetrics {
    pub trending: Option<f64>,
    pub rating: Option<f64>,
    pub recent_rating: Option<f64>,
    pub popularity: Option<f64>,
}
