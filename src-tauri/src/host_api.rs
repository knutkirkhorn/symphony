use crate::commands::{
    add_repo, clone_repo, create_agent, create_group, create_local_branch, delete_agent,
    delete_group, delete_local_branch, get_commit_changes, get_current_branch, get_remote_url,
    get_repo_sync_status, get_repo_working_tree_status, list_agents, list_git_history, list_groups,
    list_local_branches, list_repos, move_repo_to_group, open_in_cursor, open_in_file_manager,
    pull_repo, remove_repo, rename_agent, rename_group, run_repo_agent, stop_repo_agent,
    switch_branch, AgentRuntimeState,
};
use crate::db::Database;
use axum::extract::{Query, State as AxumState};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use rand::distr::Alphanumeric;
use rand::Rng;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::net::SocketAddr;
use tauri::{Manager, State as TauriState};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone, Debug)]
pub struct BridgeEvent {
    pub event: String,
    pub payload: Value,
}

#[derive(Clone)]
pub struct HostBridgeState {
    sender: broadcast::Sender<BridgeEvent>,
}

impl HostBridgeState {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self { sender }
    }

    pub fn send_event(&self, event: &str, payload: Value) {
        let _ = self.sender.send(BridgeEvent {
            event: event.to_string(),
            payload,
        });
    }

    fn subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.sender.subscribe()
    }
}

#[derive(Clone)]
struct HttpBridgeAppState {
    app: tauri::AppHandle,
    events: HostBridgeState,
    auth_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvokeRequest {
    command: String,
    args: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InvokeResponse {
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EventQueryParameters {
    token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArgs {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveRepoArgs {
    id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoIdArgs {
    repo_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentArgs {
    repo_id: i64,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentIdArgs {
    agent_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameAgentArgs {
    agent_id: i64,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddRepoArgs {
    path: String,
    group_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloneRepoArgs {
    url: String,
    destination_parent: String,
    group_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListGitHistoryArgs {
    path: String,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitChangesArgs {
    path: String,
    commit: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoSyncArgs {
    path: String,
    fetch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchBranchArgs {
    path: String,
    target_branch: String,
    move_changes: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLocalBranchArgs {
    path: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteLocalBranchArgs {
    path: String,
    branch_name: String,
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRepoAgentArgs {
    repo_path: String,
    prompt: String,
    agent_id: i64,
    run_id: String,
    force_approve: Option<bool>,
    simulate_mode: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupIdArgs {
    id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGroupArgs {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameGroupArgs {
    id: i64,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveRepoToGroupArgs {
    repo_id: i64,
    group_id: Option<i64>,
}

fn deserialize_args<T: DeserializeOwned>(value: Option<Value>) -> Result<T, String> {
    let raw = value.unwrap_or_else(|| json!({}));
    serde_json::from_value(raw).map_err(|error| format!("Invalid args: {}", error))
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            headers
                .get("x-symphony-token")
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn is_authorized(headers: &HeaderMap, query_token: Option<&str>, expected_token: &str) -> bool {
    let header_token = extract_bearer_token(headers);
    let token = header_token.or_else(|| {
        query_token
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    });
    token.as_deref() == Some(expected_token)
}

fn invoke_dispatch(
    app: &tauri::AppHandle,
    command_name: &str,
    args: Option<Value>,
) -> Result<Value, String> {
    let db: TauriState<'_, Database> = app.state();
    let agent_runtime: TauriState<'_, AgentRuntimeState> = app.state();

    match command_name {
        "list_repos" => Ok(serde_json::to_value(list_repos(db)?).map_err(|e| e.to_string())?),
        "add_repo" => {
            let parsed: AddRepoArgs = deserialize_args(args)?;
            Ok(serde_json::to_value(add_repo(db, parsed.path, parsed.group_id)?)
                .map_err(|e| e.to_string())?)
        }
        "clone_repo" => {
            let parsed: CloneRepoArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(clone_repo(
                    db,
                    parsed.url,
                    parsed.destination_parent,
                    parsed.group_id,
                )?)
                .map_err(|e| e.to_string())?,
            )
        }
        "remove_repo" => {
            let parsed: RemoveRepoArgs = deserialize_args(args)?;
            remove_repo(db, parsed.id)?;
            Ok(Value::Null)
        }
        "open_in_cursor" => {
            let parsed: PathArgs = deserialize_args(args)?;
            open_in_cursor(parsed.path)?;
            Ok(Value::Null)
        }
        "open_in_file_manager" => {
            let parsed: PathArgs = deserialize_args(args)?;
            open_in_file_manager(parsed.path)?;
            Ok(Value::Null)
        }
        "get_remote_url" => {
            let parsed: PathArgs = deserialize_args(args)?;
            Ok(serde_json::to_value(get_remote_url(parsed.path)?).map_err(|e| e.to_string())?)
        }
        "get_current_branch" => {
            let parsed: PathArgs = deserialize_args(args)?;
            Ok(serde_json::to_value(get_current_branch(parsed.path)?).map_err(|e| e.to_string())?)
        }
        "list_local_branches" => {
            let parsed: PathArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(list_local_branches(parsed.path)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "get_repo_working_tree_status" => {
            let parsed: PathArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(get_repo_working_tree_status(parsed.path)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "switch_branch" => {
            let parsed: SwitchBranchArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(switch_branch(
                    parsed.path,
                    parsed.target_branch,
                    parsed.move_changes,
                )?)
                .map_err(|e| e.to_string())?,
            )
        }
        "create_local_branch" => {
            let parsed: CreateLocalBranchArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(create_local_branch(parsed.path, parsed.name)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "delete_local_branch" => {
            let parsed: DeleteLocalBranchArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(delete_local_branch(
                    parsed.path,
                    parsed.branch_name,
                    parsed.force,
                )?)
                .map_err(|e| e.to_string())?,
            )
        }
        "get_repo_sync_status" => {
            let parsed: RepoSyncArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(get_repo_sync_status(parsed.path, parsed.fetch)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "pull_repo" => {
            let parsed: PathArgs = deserialize_args(args)?;
            Ok(serde_json::to_value(pull_repo(parsed.path)?).map_err(|e| e.to_string())?)
        }
        "list_git_history" => {
            let parsed: ListGitHistoryArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(list_git_history(parsed.path, parsed.limit)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "get_commit_changes" => {
            let parsed: CommitChangesArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(get_commit_changes(parsed.path, parsed.commit)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "list_agents" => {
            let parsed: RepoIdArgs = deserialize_args(args)?;
            Ok(serde_json::to_value(list_agents(db, parsed.repo_id)?).map_err(|e| e.to_string())?)
        }
        "create_agent" => {
            let parsed: CreateAgentArgs = deserialize_args(args)?;
            Ok(
                serde_json::to_value(create_agent(db, parsed.repo_id, parsed.name)?)
                    .map_err(|e| e.to_string())?,
            )
        }
        "delete_agent" => {
            let parsed: AgentIdArgs = deserialize_args(args)?;
            delete_agent(db, parsed.agent_id)?;
            Ok(Value::Null)
        }
        "rename_agent" => {
            let parsed: RenameAgentArgs = deserialize_args(args)?;
            rename_agent(db, parsed.agent_id, parsed.name)?;
            Ok(Value::Null)
        }
        "run_repo_agent" => {
            let parsed: RunRepoAgentArgs = deserialize_args(args)?;
            run_repo_agent(
                app.clone(),
                agent_runtime,
                parsed.repo_path,
                parsed.prompt,
                parsed.agent_id,
                parsed.run_id,
                parsed.force_approve,
                parsed.simulate_mode,
            )?;
            Ok(Value::Null)
        }
        "stop_repo_agent" => {
            stop_repo_agent(app.clone(), agent_runtime)?;
            Ok(Value::Null)
        }
        "list_groups" => Ok(serde_json::to_value(list_groups(db)?).map_err(|e| e.to_string())?),
        "create_group" => {
            let parsed: CreateGroupArgs = deserialize_args(args)?;
            Ok(serde_json::to_value(create_group(db, parsed.name)?).map_err(|e| e.to_string())?)
        }
        "rename_group" => {
            let parsed: RenameGroupArgs = deserialize_args(args)?;
            rename_group(db, parsed.id, parsed.name)?;
            Ok(Value::Null)
        }
        "delete_group" => {
            let parsed: GroupIdArgs = deserialize_args(args)?;
            delete_group(db, parsed.id)?;
            Ok(Value::Null)
        }
        "move_repo_to_group" => {
            let parsed: MoveRepoToGroupArgs = deserialize_args(args)?;
            move_repo_to_group(db, parsed.repo_id, parsed.group_id)?;
            Ok(Value::Null)
        }
        _ => Err(format!("Unknown command: {}", command_name)),
    }
}

async fn invoke_handler(
    AxumState(state): AxumState<HttpBridgeAppState>,
    headers: HeaderMap,
    Json(request): Json<InvokeRequest>,
) -> impl IntoResponse {
    if !is_authorized(&headers, None, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(InvokeResponse {
                ok: false,
                data: None,
                error: Some("Unauthorized".to_string()),
            }),
        );
    }

    let app = state.app.clone();
    let command_name = request.command;
    let args = request.args;

    let dispatch_result =
        tauri::async_runtime::spawn_blocking(move || invoke_dispatch(&app, &command_name, args))
            .await;
    match dispatch_result {
        Ok(Ok(data)) => (
            StatusCode::OK,
            Json(InvokeResponse {
                ok: true,
                data: Some(data),
                error: None,
            }),
        ),
        Ok(Err(error)) => (
            StatusCode::OK,
            Json(InvokeResponse {
                ok: false,
                data: None,
                error: Some(error),
            }),
        ),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                ok: false,
                data: None,
                error: Some(format!("Bridge task failed: {}", error)),
            }),
        ),
    }
}

async fn health_handler(
    AxumState(state): AxumState<HttpBridgeAppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_authorized(&headers, None, &state.auth_token) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "ok": false })));
    }
    (StatusCode::OK, Json(json!({ "ok": true })))
}

async fn events_handler(
    AxumState(state): AxumState<HttpBridgeAppState>,
    headers: HeaderMap,
    Query(query): Query<EventQueryParameters>,
) -> Response {
    if !is_authorized(&headers, query.token.as_deref(), &state.auth_token) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let stream = BroadcastStream::new(state.events.subscribe()).filter_map(|message| {
        let event = match message {
            Ok(payload) => payload,
            Err(_) => return None,
        };
        let data = serde_json::to_string(&event.payload).unwrap_or_else(|_| "null".to_string());
        Some(Ok::<Event, Infallible>(
            Event::default().event(event.event).data(data),
        ))
    });

    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

async fn verify_auth_handler(
    AxumState(state): AxumState<HttpBridgeAppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_authorized(&headers, None, &state.auth_token) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "ok": false })));
    }
    (StatusCode::OK, Json(json!({ "ok": true })))
}

pub fn start_host_bridge(app: tauri::AppHandle, events: HostBridgeState) {
    let bind_host = std::env::var("SYMPHONY_HOST_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let bind_port = std::env::var("SYMPHONY_HOST_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(48678);
    let socket_address: SocketAddr = match format!("{}:{}", bind_host, bind_port).parse() {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Failed to parse SYMPHONY host bridge address: {}", error);
            return;
        }
    };
    let auth_token = std::env::var("SYMPHONY_HOST_TOKEN").unwrap_or_else(|_| {
        let generated: String = rand::rng()
            .sample_iter(Alphanumeric)
            .take(40)
            .map(char::from)
            .collect();
        println!(
            "SYMPHONY_HOST_TOKEN was not set. Generated session token: {}",
            generated
        );
        generated
    });

    tauri::async_runtime::spawn(async move {
        let state = HttpBridgeAppState {
            app,
            events,
            auth_token,
        };
        let app_router = Router::new()
            .route("/health", get(health_handler))
            .route("/api/auth/verify", get(verify_auth_handler))
            .route("/api/invoke", post(invoke_handler))
            .route("/api/events", get(events_handler))
            .layer(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_headers(Any)
                    .allow_methods(Any),
            )
            .with_state(state);

        let listener = match TcpListener::bind(socket_address).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Failed to bind Symphony host bridge at {}: {}", socket_address, error);
                return;
            }
        };

        println!("Symphony host bridge listening on http://{}", socket_address);

        if let Err(error) = axum::serve(listener, app_router).await {
            eprintln!("Symphony host bridge stopped with error: {}", error);
        }
    });
}
