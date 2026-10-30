//! Headless integration harness; never registered as a desktop IPC command.
use erp_desktop::{error, recovery, storage::Store, validation::text, Result};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    path::Path,
    sync::{Arc, Mutex},
};
fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("synthetic database path required");
    let shared = Arc::new(Mutex::new(
        Store::open(Path::new(&path)).expect("open synthetic database"),
    ));
    for line in io::stdin().lock().lines() {
        let result = (|| -> Result<Value> {
            let request: Value = serde_json::from_str(&line?)?;
            let op = text(&request, "operation")?;
            let p = &request["payload"];
            if op.starts_with("cloud_") {
                return erp_desktop::cloud_ops::dispatch(&shared, op, p);
            }
            let mut store = shared
                .lock()
                .map_err(|_| error("STORAGE_UNAVAILABLE", "Harness storage worker stopped."))?;
            let _maintenance = store.operation_guard()?;
            match op {
                "status" => store.status(),
                "setup" => store.setup(text(p, "password")?),
                "unlock" => store.unlock(text(p, "password")?),
                "lock" => {
                    store.lock();
                    Ok(json!(null))
                }
                "list_books" => store.list(text(p, "token")?),
                "create_book" => store.create(text(p, "token")?, text(p, "state")?),
                "read_book" => store.read(text(p, "token")?, text(p, "companyId")?),
                "commit_book" => store.commit(
                    text(p, "token")?,
                    text(p, "companyId")?,
                    erp_desktop::validation::number(p, "revision")?,
                    text(p, "state")?,
                ),
                "commit_resolution" => store.commit_with_resolution(
                    text(p, "token")?,
                    text(p, "companyId")?,
                    erp_desktop::validation::number(p, "revision")?,
                    text(p, "state")?,
                    Some((text(p, "resolutionMode")?, text(p, "originalCommand")?)),
                ),
                "backup_file" => {
                    recovery::backup(
                        &mut store,
                        text(p, "token")?,
                        Path::new(text(p, "path")?),
                        text(p, "passphrase")?,
                    )?;
                    Ok(json!(null))
                }
                "restore_file" => {
                    recovery::restore(
                        &mut store,
                        text(p, "token")?,
                        Path::new(text(p, "path")?),
                        text(p, "passphrase")?,
                    )?;
                    Ok(json!(null))
                }
                #[cfg(debug_assertions)]
                "crash_write" => {
                    store
                        .connection
                        .execute_batch("BEGIN IMMEDIATE; UPDATE books SET revision=revision+1;")?;
                    std::process::exit(73);
                }
                #[cfg(debug_assertions)]
                "disk_limit" => {
                    store.connection.execute_batch(
                        "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA max_page_count=40;",
                    )?;
                    Ok(json!(null))
                }
                _ => Err(error(
                    "UNSUPPORTED_OPERATION",
                    "Unsupported harness operation.",
                )),
            }
        })();
        let response = match result {
            Ok(value) => json!({"ok":value}),
            Err(e) => json!({"error":e}),
        };
        println!("{response}");
        io::stdout().flush().unwrap();
    }
}
