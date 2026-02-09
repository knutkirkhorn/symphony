mod commands;
mod db;

use commands::{add_repo, get_remote_url, list_repos, open_in_cursor, remove_repo};
use db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .invoke_handler(tauri::generate_handler![list_repos, add_repo, remove_repo, open_in_cursor, get_remote_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
