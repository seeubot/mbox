use crate::models::BrowseMetrics;
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
