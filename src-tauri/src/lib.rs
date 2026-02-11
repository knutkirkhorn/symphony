mod commands;
mod db;

use commands::{
    add_repo, clone_repo, create_agent, create_group, delete_agent, delete_group, get_commit_changes,
    get_current_branch, get_remote_url, get_repo_sync_status, list_agents, list_git_history,
    list_groups, list_repos, move_repo_to_group, open_in_cursor, pull_repo, remove_repo,
    rename_group, run_repo_agent, stop_repo_agent, AgentRuntimeState,
};
use db::Database;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .manage(AgentRuntimeState {
            pid: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            list_repos,
            add_repo,
            clone_repo,
            remove_repo,
            open_in_cursor,
            get_remote_url,
            get_current_branch,
            get_repo_sync_status,
            pull_repo,
            list_git_history,
            get_commit_changes,
            list_agents,
            create_agent,
            delete_agent,
            run_repo_agent,
            stop_repo_agent,
            list_groups,
            create_group,
            rename_group,
            delete_group,
            move_repo_to_group
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
