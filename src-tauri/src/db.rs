use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = get_db_path();

        // Ensure the .symphony directory exists
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).expect("Failed to create .symphony directory");
        }

        let conn = Connection::open(&db_path)?;

        // Create tables
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS repos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                group_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS agents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
            );",
        )?;

        // Migration: add group_id column if it doesn't exist (for existing databases)
        let has_group_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('repos') WHERE name='group_id'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_group_id {
            conn.execute_batch(
                "ALTER TABLE repos ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;",
            )?;
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

fn get_db_path() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".symphony").join("symphony.db")
}
