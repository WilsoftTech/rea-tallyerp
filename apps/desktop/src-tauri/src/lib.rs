pub mod cloud;
pub mod cloud_ops;
pub mod grants;
pub mod recovery;
pub mod storage;
pub mod sync_store;
#[cfg(test)]
mod tests;
pub mod transport;
pub mod validation;

use serde::Serialize;
#[derive(Debug, Serialize)]
pub struct Error {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
    pub retry_after: Option<u64>,
}
pub type Result<T> = std::result::Result<T, Error>;
pub fn error(code: &str, message: &str) -> Error {
    Error {
        code: code.into(),
        message: message.into(),
        field: None,
        retry_after: None,
    }
}
impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        let code = match &e {
            rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::DiskFull => {
                "DISK_FULL"
            }
            rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::DatabaseBusy => {
                "STORAGE_BUSY"
            }
            _ => "STORAGE_ERROR",
        };
        // Do not expose SQL, paths or stored financial payloads through errors.
        error(code, "Storage operation failed; no successful save was acknowledged. Check device space and retry.")
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        error(
            "FILE_ERROR",
            "File operation failed. Check access and available space.",
        )
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        error(
            "INVALID_DATA",
            "Stored or supplied data has an invalid structure.",
        )
    }
}
