use crate::providers::moviebox::client::MovieBoxClient;
use std::sync::Arc;
#[derive(Clone)]
pub struct AppState {
    pub moviebox: Arc<MovieBoxClient>,
}
impl AppState {
    pub fn new() -> Self {
        Self {
            moviebox: Arc::new(MovieBoxClient::new()),
        }
    }
}
impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
