use crate::db::Database;
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize, Clone)]
pub struct Repo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub group_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[tauri::command]
pub fn list_repos(db: State<'_, Database>) -> Result<Vec<Repo>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, path, group_id, created_at FROM repos ORDER BY name ASC")
        .map_err(|e| e.to_string())?;

    let repos = stmt
        .query_map([], |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                group_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(repos)
}

#[tauri::command]
pub fn add_repo(db: State<'_, Database>, path: String) -> Result<Repo, String> {
    let repo_path = Path::new(&path);

    // Check if the directory exists
    if !repo_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    // Check if it's a git repo
    let git_dir = repo_path.join(".git");
    if !git_dir.exists() {
        return Err("The selected directory is not a Git repository".to_string());
    }

    // Extract repo name from the directory name
    let name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO repos (name, path) VALUES (?1, ?2)",
        rusqlite::params![name, path],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            "This repository has already been added".to_string()
        } else {
            e.to_string()
        }
    })?;

    let id = conn.last_insert_rowid();

    let mut stmt = conn
        .prepare("SELECT id, name, path, group_id, created_at FROM repos WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let repo = stmt
        .query_row(rusqlite::params![id], |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                group_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(repo)
}

#[tauri::command]
pub fn remove_repo(db: State<'_, Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM repos WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteInfo {
    pub provider: String,
    pub url: String,
}

#[tauri::command]
pub fn get_remote_url(path: String) -> Result<Option<RemoteInfo>, String> {
    let output = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let remote_url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if remote_url.is_empty() {
        return Ok(None);
    }

    Ok(parse_remote_url(&remote_url))
}

fn parse_remote_url(remote_url: &str) -> Option<RemoteInfo> {
    let url = remote_url.trim_end_matches(".git");

    if url.contains("github.com") {
        let web_url = if url.starts_with("git@") {
            url.replace("git@github.com:", "https://github.com/")
        } else {
            url.to_string()
        };
        Some(RemoteInfo {
            provider: "github".to_string(),
            url: web_url,
        })
    } else if url.contains("gitlab.com") {
        let web_url = if url.starts_with("git@") {
            url.replace("git@gitlab.com:", "https://gitlab.com/")
        } else {
            url.to_string()
        };
        Some(RemoteInfo {
            provider: "gitlab".to_string(),
            url: web_url,
        })
    } else {
        None
    }
}

#[tauri::command]
pub fn list_groups(db: State<'_, Database>) -> Result<Vec<Group>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, sort_order, created_at FROM groups ORDER BY sort_order ASC, name ASC")
        .map_err(|e| e.to_string())?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(groups)
}

#[tauri::command]
pub fn create_group(db: State<'_, Database>, name: String) -> Result<Group, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get the next sort_order
    let max_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), 0) FROM groups", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO groups (name, sort_order) VALUES (?1, ?2)",
        rusqlite::params![name, max_order + 1],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    let mut stmt = conn
        .prepare("SELECT id, name, sort_order, created_at FROM groups WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let group = stmt
        .query_row(rusqlite::params![id], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(group)
}

#[tauri::command]
pub fn rename_group(db: State<'_, Database>, id: i64, name: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE groups SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_group(db: State<'_, Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // Unassign repos from this group first (ON DELETE SET NULL handles this, but be explicit)
    conn.execute(
        "UPDATE repos SET group_id = NULL WHERE group_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM groups WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_repo_to_group(db: State<'_, Database>, repo_id: i64, group_id: Option<i64>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE repos SET group_id = ?1 WHERE id = ?2",
        rusqlite::params![group_id, repo_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_in_cursor(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "cursor", &path])
            .spawn()
            .map_err(|e| format!("Failed to open in Cursor: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("cursor")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in Cursor: {}", e))?;
    }
    Ok(())
}
