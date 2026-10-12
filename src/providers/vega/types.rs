use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaProvider {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "bundleUrl")]
    pub bundle_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaCatalog {
    pub title: String,
    pub filter: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaPost {
    pub title: String,
    pub link: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default, rename = "providerId")]
    pub provider_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaDirectLink {
    pub title: String,
    pub link: String,
    #[serde(default, rename = "type")]
    pub link_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaLink {
    pub title: String,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default, rename = "episodesLink")]
    pub episodes_link: Option<String>,
    #[serde(default, rename = "directLinks")]
    pub direct_links: Option<Vec<VegaDirectLink>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaInfo {
    pub title: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub synopsis: Option<String>,
    #[serde(default, rename = "imdbId")]
    pub imdb_id: Option<String>,
    #[serde(default, rename = "type")]
    pub info_type: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub cast: Option<Vec<String>>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default, rename = "linkList")]
    pub link_list: Vec<VegaLink>,
    #[serde(default, rename = "webUrl")]
    pub web_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaEpisodeLink {
    pub title: String,
    pub link: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VegaStream {
    pub server: String,
    pub link: String,
    #[serde(default, rename = "type")]
    pub stream_type: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub headers: Option<serde_json::Value>,
}