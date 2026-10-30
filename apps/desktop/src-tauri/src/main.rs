#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(feature = "desktop")]
mod desktop {
    use erp_desktop::{error, recovery, storage::Store, validation::text, Result};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    #[tauri::command]
    pub async fn accounting(
        operation: String,
        payload: Value,
        state: tauri::State<'_, Arc<Mutex<Store>>>,
    ) -> Result<Value> {
        let shared = Arc::clone(state.inner());
        tauri::async_runtime::spawn_blocking(move || dispatch(&shared,&operation,&payload)).await
            .map_err(|_|error("WORKER_FAILED","Operation worker stopped. Reopen and inspect the persisted receipt before retrying."))?
    }
    fn dispatch(shared: &Arc<Mutex<Store>>, operation: &str, payload: &Value) -> Result<Value> {
        if payload.to_string().len() > 17 * 1024 * 1024 {
            return Err(error("DATA_LIMIT", "Command is too large."));
        }
        if operation.starts_with("cloud_") {
            return erp_desktop::cloud_ops::dispatch(shared, operation, payload);
        }
        let mut store = shared.lock().map_err(|_| {
            error(
                "STORAGE_UNAVAILABLE",
                "Restart the application to recover the storage connection.",
            )
        })?;
        if payload.to_string().len() > 17 * 1024 * 1024 {
            return Err(error("DATA_LIMIT", "Command is too large."));
        }
        let _maintenance = store.operation_guard()?;
        match operation {
            "status" => store.status(),
            "setup" => store.setup(text(payload, "password")?),
            "unlock" => store.unlock(text(payload, "password")?),
            "lock" => {
                store.lock();
                Ok(json!(null))
            }
            _ => {
                let token = text(payload, "token")?;
                store.authorize(token)?;
                match operation {
                    "list_books" => store.list(token),
                    "read_book" => store.read(token, text(payload, "companyId")?),
                    "create_book" => store.create(token, text(payload, "state")?),
                    "commit_book" => store.commit(
                        token,
                        text(payload, "companyId")?,
                        erp_desktop::validation::number(payload, "revision")?,
                        text(payload, "state")?,
                    ),
                    "commit_resolution" => store.commit_with_resolution(
                        token,
                        text(payload, "companyId")?,
                        erp_desktop::validation::number(payload, "revision")?,
                        text(payload, "state")?,
                        Some((
                            text(payload, "resolutionMode")?,
                            text(payload, "originalCommand")?,
                        )),
                    ),
                    "backup" => {
                        let path = rfd::FileDialog::new()
                            .add_filter("Encrypted accounting backup", &["erpbackup"])
                            .set_file_name("accounting.erpbackup")
                            .save_file();
                        if let Some(path) = path {
                            recovery::backup(
                                &mut store,
                                token,
                                &path,
                                text(payload, "passphrase")?,
                            )?;
                            Ok(json!({"completed":true}))
                        } else {
                            Ok(json!({"completed":false}))
                        }
                    }
                    "restore" => {
                        if payload["confirmed"] != true {
                            return Err(error(
                                "CONFIRM_RESTORE",
                                "Confirm replacement of this device's records before restoring.",
                            ));
                        }
                        let path = rfd::FileDialog::new()
                            .add_filter("Encrypted accounting backup", &["erpbackup"])
                            .pick_file();
                        if let Some(path) = path {
                            recovery::restore(
                                &mut store,
                                token,
                                &path,
                                text(payload, "passphrase")?,
                            )?;
                            Ok(json!({"completed":true}))
                        } else {
                            Ok(json!({"completed":false}))
                        }
                    }
                    _ => Err(error(
                        "UNSUPPORTED_OPERATION",
                        "This local application does not support that operation.",
                    )),
                }
            }
        }
    }
    pub fn run() {
        tauri::Builder::default()
            .setup(|app| {
                let directory = app.path().app_local_data_dir()?;
                #[cfg(debug_assertions)]
                let directory = std::env::var_os("ERP_TEST_DATA_DIR")
                    .map(std::path::PathBuf::from)
                    .unwrap_or(directory);
                // An invalid existing database is never reset or silently replaced.
                let store = Store::open(&directory.join("accounting.sqlite"))
                    .map_err(|e| std::io::Error::other(format!("{}: {}", e.code, e.message)))?;
                app.manage(Arc::new(Mutex::new(store)));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![accounting])
            .run(tauri::generate_context!())
            .expect("Desktop runtime failed; preserve the database before recovery");
    }
}
fn main() {
    #[cfg(feature = "desktop")]
    desktop::run();
}
