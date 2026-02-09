mod commands;
mod db;

use commands::{add_repo, list_repos, remove_repo};
use db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .invoke_handler(tauri::generate_handler![list_repos, add_repo, remove_repo])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
