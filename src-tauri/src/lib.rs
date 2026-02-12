mod commands;
mod db;
mod host_api;

use commands::{
    add_repo, clone_repo, create_agent, create_group, create_local_branch, delete_agent,
    delete_group, delete_local_branch, get_commit_changes, get_current_branch, get_remote_url,
    get_repo_sync_status, get_repo_working_tree_status, list_agents, list_git_history, list_groups,
    list_local_branches, list_repos, move_repo_to_group, open_in_cursor, open_in_file_manager,
    pull_repo, remove_repo, rename_agent, rename_group, run_repo_agent, stop_repo_agent,
    switch_branch, AgentRuntimeState,
};
use db::Database;
use host_api::{start_host_bridge, HostBridgeState};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new().expect("Failed to initialize database");
    let host_bridge_state = HostBridgeState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .manage(host_bridge_state.clone())
        .manage(AgentRuntimeState {
            pid: Mutex::new(None),
        })
        .setup(move |app| {
            start_host_bridge(app.handle().clone(), host_bridge_state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_repos,
            add_repo,
            clone_repo,
            remove_repo,
            open_in_cursor,
            open_in_file_manager,
            get_remote_url,
            get_current_branch,
            list_local_branches,
            get_repo_working_tree_status,
            switch_branch,
            create_local_branch,
            delete_local_branch,
            get_repo_sync_status,
            pull_repo,
            list_git_history,
            get_commit_changes,
            list_agents,
            create_agent,
            delete_agent,
            rename_agent,
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
