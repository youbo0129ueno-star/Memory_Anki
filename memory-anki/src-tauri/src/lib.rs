// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Default)]
struct StoragePayload {
    cards: serde_json::Value,
    decks: Vec<String>,
}

fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("memory-anki-storage.json"))
}

#[tauri::command]
fn load_storage(app: AppHandle) -> Result<StoragePayload, String> {
    let path = storage_path(&app)?;
    if !path.exists() {
        return Ok(StoragePayload::default());
    }
    let contents = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&contents).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_storage(app: AppHandle, payload: StoragePayload) -> Result<(), String> {
    let path = storage_path(&app)?;
    let contents = serde_json::to_string_pretty(&payload).map_err(|err| err.to_string())?;
    fs::write(path, contents).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![load_storage, save_storage])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
