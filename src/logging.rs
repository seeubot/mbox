pub fn sanitize_url(url: &str) -> String {
    match url.split_once('?') {
        Some((base, _)) => format!("{base}?<redacted>"),
        None => url.to_string(),
    }
}
pub fn sanitize_path(path: &std::path::Path) -> String {
    path.display().to_string()
}
