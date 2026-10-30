use crate::{
    error,
    storage::{random, Store},
    Result,
};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rusqlite::{backup::Backup, Connection};
use std::{fs, io::Write, path::Path, time::Duration};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"ERPBAK01";
const MAX: u64 = 128 * 1024 * 1024;
fn key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err(error(
            "INVALID_PASSWORD",
            "Use a backup passphrase of 12–1024 characters.",
        ));
    }
    let mut key = Zeroizing::new([0; 32]);
    // Format ERPBAK01 fixes these parameters; future changes need a new format version.
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19 * 1024, 2, 1, Some(32))
            .map_err(|_| error("CRYPTO_ERROR", "Invalid backup KDF parameters."))?,
    )
    .hash_password_into(password.as_bytes(), salt, &mut *key)
    .map_err(|_| error("CRYPTO_ERROR", "Backup key derivation failed."))?;
    Ok(key)
}
fn copy(from: &Connection, to: &mut Connection) -> Result<()> {
    Backup::new(from, to)?.run_to_completion(64, Duration::from_millis(2), None)?;
    Ok(())
}
pub fn backup(store: &mut Store, token: &str, destination: &Path, passphrase: &str) -> Result<()> {
    store.authorize(token)?;
    store.check_integrity()?;
    let temporary = tempfile::tempdir()?;
    let snapshot = temporary.path().join("snapshot.sqlite");
    let mut connection = Connection::open(&snapshot)?;
    copy(&store.connection, &mut connection)?;
    drop(connection);
    if fs::metadata(&snapshot)?.len() > MAX {
        return Err(error(
            "BACKUP_TOO_LARGE",
            "This version supports backups up to 128 MiB.",
        ));
    }
    let plaintext = Zeroizing::new(fs::read(&snapshot)?);
    let salt = random::<16>()?;
    let nonce = random::<12>()?;
    let mut header = Vec::from(MAGIC.as_slice());
    header.extend(salt);
    header.extend(nonce);
    let key = key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&*key)
        .map_err(|_| error("CRYPTO_ERROR", "Cannot initialize backup encryption."))?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &header,
            },
        )
        .map_err(|_| error("CRYPTO_ERROR", "Cannot encrypt backup."))?;
    let parent = destination
        .parent()
        .ok_or_else(|| error("FILE_ERROR", "Choose a backup location."))?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    output.write_all(&header)?;
    output.write_all(&encrypted)?;
    output.as_file().sync_all()?;
    // An existing backup is preserved: select a fresh file name instead of replacing it.
    output.persist_noclobber(destination).map_err(|_| {
        error(
            "BACKUP_EXISTS",
            "Backup was not saved. Choose a new file name or check destination access.",
        )
    })?;
    Ok(())
}
pub fn restore(store: &mut Store, token: &str, source: &Path, passphrase: &str) -> Result<()> {
    store.authorize(token)?;
    let size = fs::metadata(source)?.len();
    if !(52..=MAX + 52).contains(&size) {
        return Err(error("INVALID_BACKUP", "Backup size is unsupported."));
    }
    let file = fs::read(source)?;
    if &file[..8] != MAGIC {
        return Err(error(
            "INVALID_BACKUP",
            "Backup format/version is unsupported.",
        ));
    }
    let key = key(passphrase, &file[8..24])?;
    let cipher = Aes256Gcm::new_from_slice(&*key)
        .map_err(|_| error("CRYPTO_ERROR", "Cannot initialize backup decryption."))?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&file[24..36]),
                Payload {
                    msg: &file[36..],
                    aad: &file[..36],
                },
            )
            .map_err(|_| {
                error(
                    "BACKUP_AUTH_FAILED",
                    "Wrong passphrase or damaged backup. Current data is unchanged.",
                )
            })?,
    );
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("restore.sqlite");
    fs::write(&path, &*plaintext)?;
    // Do not migrate an imported file: exact supported schema and full integrity are required.
    let version: i64 =
        Connection::open(&path)?.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if !(1..=2).contains(&version) {
        return Err(error("INVALID_BACKUP", "Backup schema is unsupported."));
    }
    let candidate = Store::open(&path)?;
    candidate.check_integrity()?;
    if candidate.status()?["initialized"] != true {
        return Err(error(
            "INVALID_BACKUP",
            "Backup does not contain an initialized device vault.",
        ));
    }
    // Rotate in the candidate before the atomic copy: every other process's
    // previous session becomes invalid at the same instant as the restore.
    candidate.connection.execute(
        "UPDATE vault SET generation=? WHERE singleton=1",
        [crate::storage::hex(&random::<16>()?)],
    )?;
    candidate.connection.execute(
        "UPDATE sync_profiles SET paused='restored',lease_owner=NULL,lease_until=0",
        [],
    )?;
    candidate.connection.execute(
        "UPDATE outbox SET state='pending',lease_owner=NULL,lease_until=0 WHERE state='sending'",
        [],
    )?;
    // SQLite's backup API replaces the destination in one transaction. Failure rolls it back.
    copy(&candidate.connection, &mut store.connection)?;
    store.lock();
    Ok(())
}
