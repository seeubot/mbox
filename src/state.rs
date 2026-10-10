use crate::service::MediaService;
use std::sync::Arc;
#[derive(Clone)]
pub struct AppState {
    pub media: Arc<MediaService>,
}
impl AppState {
    pub fn new() -> Self {
        Self {
            media: Arc::new(MediaService::new()),
        }
    }
}
impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}