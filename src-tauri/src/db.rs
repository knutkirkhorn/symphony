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
            "CREATE TABLE IF NOT EXISTS repos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

fn get_db_path() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".symphony").join("symphony.db")
}
