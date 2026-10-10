use md5::{Digest, Md5};
use serde::{de::DeserializeOwned, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
struct Entry {
    expires_at: Instant,
    bytes: Vec<u8>,
}
static STORE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
fn store() -> &'static Mutex<HashMap<String, Entry>> {
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn md5_hex_bytes(input: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(input);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest.iter() {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}
pub fn md5_hex(input: &str) -> String {
    md5_hex_bytes(input.as_bytes())
}
pub fn get_typed_cache<T: DeserializeOwned>(path: &Path, _max_age_secs: u64) -> Option<T> {
    let key = path.display().to_string();
    let map = store().lock().ok()?;
    let entry = map.get(&key)?;
    if entry.expires_at <= Instant::now() {
        return None;
    }
    serde_json::from_slice(&entry.bytes).ok()
}
pub fn set_typed_cache<T: Serialize>(path: &Path, max_age_secs: u64, value: &T) {
    let key = path.display().to_string();
    let Ok(bytes) = serde_json::to_vec(value) else {
        return;
    };
    let mut map = match store().lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    map.insert(
        key,
        Entry {
            expires_at: Instant::now() + Duration::from_secs(max_age_secs),
            bytes,
        },
    );
}
pub fn atomic_write_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, data)
}
