use std::path::PathBuf;
pub const APP_NAME: &str = "mbox";
pub fn cache_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("MOVIEBOX_CACHE_DIR") {
        return PathBuf::from(dir);
    }
    dirs::cache_dir()
        .map(|d| d.join(APP_NAME))
        .unwrap_or_else(|| std::env::temp_dir().join(APP_NAME))
}
