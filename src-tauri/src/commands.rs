use crate::db::Database;
use rusqlite::Connection;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

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

#[derive(Debug, Serialize, Clone)]
pub struct Agent {
    pub id: i64,
    pub repo_id: i64,
    pub name: String,
    pub created_at: String,
}

pub struct AgentRuntimeState {
    pub pid: Mutex<Option<u32>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamPayload {
    pub run_id: String,
    pub agent_id: i64,
    pub line: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentDonePayload {
    pub run_id: String,
    pub agent_id: i64,
    pub success: bool,
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
pub fn add_repo(
    db: State<'_, Database>,
    path: String,
    group_id: Option<i64>,
) -> Result<Repo, String> {
    let repo_path = Path::new(&path);
    let name = validate_git_repo(repo_path)?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    insert_repo(&conn, &name, &path, group_id)
}

#[tauri::command]
pub fn clone_repo(
    db: State<'_, Database>,
    url: String,
    destination_parent: String,
    group_id: Option<i64>,
) -> Result<Repo, String> {
    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        return Err("Repository URL is required".to_string());
    }

    let parent_path = Path::new(&destination_parent);
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err("Destination folder does not exist".to_string());
    }

    let repo_name = extract_repo_name_from_url(trimmed_url)?;
    let destination_path = parent_path.join(&repo_name);
    if destination_path.exists() {
        return Err(format!(
            "Destination already exists: {}",
            destination_path.display()
        ));
    }

    let output = std::process::Command::new("git")
        .args(["clone", trimmed_url, &destination_path.to_string_lossy()])
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Git clone failed".to_string()
        };
        return Err(message);
    }

    validate_git_repo(&destination_path)?;
    let destination = destination_path.to_string_lossy().to_string();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    insert_repo(&conn, &repo_name, &destination, group_id)
}

#[tauri::command]
pub fn remove_repo(db: State<'_, Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM agents WHERE repo_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM repos WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_agents(db: State<'_, Database>, repo_id: i64) -> Result<Vec<Agent>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, repo_id, name, created_at
             FROM agents
             WHERE repo_id = ?1
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;

    let agents = stmt
        .query_map(rusqlite::params![repo_id], |row| {
            Ok(Agent {
                id: row.get(0)?,
                repo_id: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(agents)
}

#[tauri::command]
pub fn create_agent(db: State<'_, Database>, repo_id: i64, name: String) -> Result<Agent, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Agent name is required".to_string());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO agents (repo_id, name) VALUES (?1, ?2)",
        rusqlite::params![repo_id, trimmed_name],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    let mut stmt = conn
        .prepare("SELECT id, repo_id, name, created_at FROM agents WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let agent = stmt
        .query_row(rusqlite::params![id], |row| {
            Ok(Agent {
                id: row.get(0)?,
                repo_id: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(agent)
}

#[tauri::command]
pub fn delete_agent(db: State<'_, Database>, agent_id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let deleted_rows = conn
        .execute(
            "DELETE FROM agents WHERE id = ?1",
            rusqlite::params![agent_id],
        )
        .map_err(|e| e.to_string())?;

    if deleted_rows == 0 {
        return Err("Agent not found".to_string());
    }

    Ok(())
}

fn validate_git_repo(repo_path: &Path) -> Result<String, String> {
    if !repo_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    if !repo_path.join(".git").exists() {
        return Err("The selected directory is not a Git repository".to_string());
    }

    Ok(repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Unknown")
        .to_string())
}

fn insert_repo(
    conn: &Connection,
    name: &str,
    path: &str,
    group_id: Option<i64>,
) -> Result<Repo, String> {
    conn.execute(
        "INSERT INTO repos (name, path, group_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, path, group_id],
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

    stmt.query_row(rusqlite::params![id], |row| {
        Ok(Repo {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            group_id: row.get(3)?,
            created_at: row.get(4)?,
        })
    })
    .map_err(|e| e.to_string())
}

fn extract_repo_name_from_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");
    let maybe_name = trimmed.rsplit(['/', ':']).next().unwrap_or_default();
    if maybe_name.is_empty() {
        return Err("Could not determine repository name from URL".to_string());
    }

    Ok(maybe_name.to_string())
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteInfo {
    pub provider: String,
    pub url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitCommitFileDiff {
    pub path: String,
    pub diff: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct RepoSyncStatus {
    pub has_remote: bool,
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    pub can_pull: bool,
    pub error: Option<String>,
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

#[tauri::command]
pub fn get_current_branch(path: String) -> Result<String, String> {
    let branch = run_git_command(&path, &["branch".to_string(), "--show-current".to_string()])?
        .trim()
        .to_string();

    if !branch.is_empty() {
        return Ok(branch);
    }

    let short_head = run_git_command(
        &path,
        &[
            "rev-parse".to_string(),
            "--short".to_string(),
            "HEAD".to_string(),
        ],
    )?
    .trim()
    .to_string();

    Ok(format!("detached@{}", short_head))
}

#[tauri::command]
pub fn list_git_history(path: String, limit: Option<u32>) -> Result<Vec<GitCommit>, String> {
    let clamped_limit = limit.unwrap_or(50).clamp(1, 200);
    let output = run_git_command(
        &path,
        &[
            "log".to_string(),
            "--max-count".to_string(),
            clamped_limit.to_string(),
            "--date=iso-strict".to_string(),
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s".to_string(),
        ],
    )?;

    let commits = output
        .lines()
        .filter_map(|line| {
            if line.trim().is_empty() {
                return None;
            }

            let mut parts = line.splitn(6, '\u{1f}');
            let hash = parts.next()?.to_string();
            let short_hash = parts.next()?.to_string();
            let author_name = parts.next()?.to_string();
            let author_email = parts.next()?.to_string();
            let author_date = parts.next()?.to_string();
            let subject = parts.next()?.to_string();

            Some(GitCommit {
                hash,
                short_hash,
                author_name,
                author_email,
                author_date,
                subject,
            })
        })
        .collect();

    Ok(commits)
}

#[tauri::command]
pub fn get_commit_changes(path: String, commit: String) -> Result<Vec<GitCommitFileDiff>, String> {
    let trimmed_commit = commit.trim();
    if trimmed_commit.is_empty() {
        return Ok(vec![]);
    }

    let output = run_git_command(
        &path,
        &[
            "show".to_string(),
            "--format=".to_string(),
            "--patch".to_string(),
            "--no-color".to_string(),
            "--find-renames".to_string(),
            trimmed_commit.to_string(),
        ],
    )?;

    Ok(parse_commit_file_diffs(&output))
}

#[tauri::command]
pub fn get_repo_sync_status(path: String, fetch: Option<bool>) -> Result<RepoSyncStatus, String> {
    let mut status = RepoSyncStatus {
        has_remote: false,
        has_upstream: false,
        ahead: 0,
        behind: 0,
        can_pull: false,
        error: None,
    };

    // No origin means there is no upstream to compare against.
    let has_origin = run_git_status_command(&path, &["remote", "get-url", "origin"])?;
    if !has_origin {
        return Ok(status);
    }
    status.has_remote = true;

    let has_upstream = run_git_status_command(
        &path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )?;
    if !has_upstream {
        return Ok(status);
    }
    status.has_upstream = true;

    if fetch.unwrap_or(false) {
        let fetched = run_git_status_command(&path, &["fetch", "--quiet", "origin"])?;
        if !fetched {
            status.error = Some("Failed to fetch from origin".to_string());
            return Ok(status);
        }
    }

    let output = run_git_command(
        &path,
        &[
            "rev-list".to_string(),
            "--left-right".to_string(),
            "--count".to_string(),
            "@{upstream}...HEAD".to_string(),
        ],
    )?;

    let mut parts = output.split_whitespace();
    let behind = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    let ahead = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);

    status.behind = behind;
    status.ahead = ahead;
    status.can_pull = behind > 0;

    Ok(status)
}

#[tauri::command]
pub fn pull_repo(path: String) -> Result<String, String> {
    let output = run_git_command(
        &path,
        &[
            "pull".to_string(),
            "--ff-only".to_string(),
            "--stat".to_string(),
        ],
    )?;

    let trimmed = output.trim();
    if trimmed.is_empty() {
        Ok("Pull completed".to_string())
    } else {
        Ok(trimmed.to_string())
    }
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

fn run_git_command(path: &str, args: &[String]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args.iter().map(String::as_str))
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Git command failed".to_string()
        };
        return Err(message);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_status_command(path: &str, args: &[&str]) -> Result<bool, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    Ok(output.status.success())
}

fn parse_commit_file_diffs(raw_output: &str) -> Vec<GitCommitFileDiff> {
    let mut diffs: Vec<GitCommitFileDiff> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();

    for line in raw_output.lines() {
        if line.starts_with("diff --git ") {
            if let Some(path) = current_path.take() {
                diffs.push(GitCommitFileDiff {
                    path,
                    diff: current_lines.join("\n"),
                });
            }
            current_path = Some(parse_path_from_diff_header(line));
            current_lines.clear();
            current_lines.push(line.to_string());
            continue;
        }

        if current_path.is_some() {
            current_lines.push(line.to_string());
        }
    }

    if let Some(path) = current_path {
        diffs.push(GitCommitFileDiff {
            path,
            diff: current_lines.join("\n"),
        });
    }

    diffs
}

fn parse_path_from_diff_header(header_line: &str) -> String {
    let parts: Vec<&str> = header_line.split_whitespace().collect();
    if parts.len() < 4 {
        return "Unknown file".to_string();
    }

    let left = parts[2].strip_prefix("a/").unwrap_or(parts[2]);
    let right = parts[3].strip_prefix("b/").unwrap_or(parts[3]);
    if right == "/dev/null" {
        left.to_string()
    } else {
        right.to_string()
    }
}

#[tauri::command]
pub fn list_groups(db: State<'_, Database>) -> Result<Vec<Group>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, sort_order, created_at FROM groups ORDER BY sort_order ASC, name ASC",
        )
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
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM groups",
            [],
            |row| row.get(0),
        )
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
pub fn move_repo_to_group(
    db: State<'_, Database>,
    repo_id: i64,
    group_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE repos SET group_id = ?1 WHERE id = ?2",
        rusqlite::params![group_id, repo_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn run_repo_agent(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
    repo_path: String,
    prompt: String,
    agent_id: i64,
    run_id: String,
    force_approve: Option<bool>,
) -> Result<(), String> {
    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Prompt is required".to_string());
    }

    {
        let pid_guard = state.pid.lock().map_err(|e| e.to_string())?;
        if pid_guard.is_some() {
            return Err("An agent is already running".to_string());
        }
    }

    let repo = Path::new(&repo_path);
    if !repo.exists() || !repo.is_dir() {
        return Err("Repository path does not exist".to_string());
    }

    let mut process = create_cursor_agent_command(trimmed_prompt, force_approve.unwrap_or(true))?;
    process.current_dir(repo);
    process.stdin(Stdio::null());
    process.stdout(Stdio::piped());
    process.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = process
        .spawn()
        .map_err(|e| format!("Failed to start Cursor agent: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture Cursor agent stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture Cursor agent stderr".to_string())?;

    {
        let mut pid_guard = state.pid.lock().map_err(|e| e.to_string())?;
        *pid_guard = Some(child.id());
    }

    let app_for_worker = app.clone();
    std::thread::spawn(move || {
        let run_id_for_stderr = run_id.clone();
        let app_for_stderr = app_for_worker.clone();
        let stderr_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_for_stderr.emit(
                    "repo-agent-stderr",
                    AgentStreamPayload {
                        run_id: run_id_for_stderr.clone(),
                        agent_id,
                        line,
                    },
                );
            }
        });

        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_for_worker.emit(
                "repo-agent-stdout",
                AgentStreamPayload {
                    run_id: run_id.clone(),
                    agent_id,
                    line,
                },
            );
        }

        let _ = stderr_handle.join();
        let success = child.wait().map(|status| status.success()).unwrap_or(false);

        if let Ok(mut pid_guard) = app_for_worker.state::<AgentRuntimeState>().pid.lock() {
            *pid_guard = None;
        }

        let _ = app_for_worker.emit(
            "repo-agent-done",
            AgentDonePayload {
                run_id,
                agent_id,
                success,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn stop_repo_agent(app: AppHandle, state: State<'_, AgentRuntimeState>) -> Result<(), String> {
    let pid = {
        let guard = state.pid.lock().map_err(|e| e.to_string())?;
        *guard
    };

    let Some(pid) = pid else {
        return Err("No agent process is currently running".to_string());
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Failed to stop running agent".to_string()
            } else {
                stderr
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    {
        let mut guard = state.pid.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }

    let _ = app.emit("repo-agent-force-stop", true);
    Ok(())
}

fn create_cursor_agent_command(
    prompt: &str,
    force_approve: bool,
) -> Result<std::process::Command, String> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data =
            std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA env var not found")?;
        let agent_path = Path::new(&local_app_data)
            .join("cursor-agent")
            .join("agent.CMD");
        if !agent_path.exists() {
            return Err(format!("agent.CMD not found at {}", agent_path.display()));
        }

        let mut command = std::process::Command::new("cmd");
        command.args(["/C", agent_path.to_string_lossy().as_ref()]);
        command.arg(prompt);
        command.args(["--output-format", "stream-json", "--print"]);
        if force_approve {
            command.arg("--force");
        }
        return Ok(command);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut command = std::process::Command::new("cursor-agent");
        command.arg(prompt);
        command.args(["--output-format", "stream-json", "--print"]);
        if force_approve {
            command.arg("--force");
        }
        Ok(command)
    }
}

#[tauri::command]
pub fn open_in_cursor(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Prefer launching the Cursor desktop app directly, and fall back to the CLI
        // if the desktop executable cannot be found.
        let local_app_data = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA env var not found".to_string())?;
        let cursor_exe_path = Path::new(&local_app_data)
            .join("Programs")
            .join("cursor")
            .join("Cursor.exe");

        if cursor_exe_path.exists() {
            std::process::Command::new(cursor_exe_path)
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open in Cursor app: {}", e))?;
        } else {
            // Fallback to the CLI for older / non-standard installs.
            std::process::Command::new("cmd")
                .args(["/c", "cursor", &path])
                .spawn()
                .map_err(|e| format!("Failed to open in Cursor (CLI fallback): {}", e))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        // On macOS, ask the system to open the folder with the Cursor app.
        // This uses the GUI app directly instead of relying on the `cursor` CLI.
        let open_result = std::process::Command::new("open")
            .args(["-a", "Cursor", &path])
            .spawn();

        if let Err(e) = open_result {
            // Fallback to the CLI if `open` is not available or fails to spawn.
            std::process::Command::new("cursor")
                .arg(&path)
                .spawn()
                .map_err(|cli_err| {
                    format!(
                        "Failed to open in Cursor app (open error: {e}); CLI fallback also failed: {cli_err}"
                    )
                })?;
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        // On Linux and other Unix-like systems, use the `cursor` binary.
        // This is typically the desktop app launcher, not just a CLI.
        std::process::Command::new("cursor")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in Cursor: {}", e))?;
    }
    Ok(())
}
