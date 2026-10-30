use crate::{
    recovery,
    storage::{Store, MIGRATION},
    validation,
};
use rusqlite::Connection;
use serde_json::json;

#[test]
fn interrupted_migration_rolls_back_and_next_open_recovers() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("migration.sqlite");
    {
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        connection.execute_batch(MIGRATION).unwrap();
        // Closing an uncommitted connection simulates an interrupted migration transaction.
    }
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='books'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    drop(connection);
    let store = Store::open(&path).unwrap();
    store.check_integrity().unwrap();
    assert_eq!(
        store
            .connection
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
}
#[test]
fn v1_to_v2_migration_is_atomic_and_preserves_existing_vault() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("upgrade.sqlite");
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch(MIGRATION).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    connection
        .execute_batch(crate::storage::SYNC_MIGRATION)
        .unwrap();
    drop(connection); // Crash before COMMIT leaves the old schema intact.
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(connection);
    let store = Store::open(&path).unwrap();
    store.check_integrity().unwrap();
    assert_eq!(store.status().unwrap()["schema"], 2);
}
#[test]
fn signed_offline_grants_reject_tampering_expiry_clock_rollback_and_key_substitution() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};
    let key = SigningKey::from_bytes(&[17; 32]);
    let public = URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes());
    let body=serde_json::to_vec(&json!({"protocol":1,"tenantId":"t","companyId":"c","userId":"u","deviceId":"d","generation":"g","sourceTenant":"s","sourceCompany":"b","epoch":"e","permissions":["read","post"],"issuedAt":1000,"expiresAt":87400,"roleVersion":1})).unwrap();
    let signed = json!({"payload":URL_SAFE_NO_PAD.encode(&body),"signature":URL_SAFE_NO_PAD.encode(key.sign(&body).to_bytes()),"publicKey":public});
    assert_eq!(
        crate::grants::verify(&signed, &public, 1100, 1100)
            .unwrap()
            .expires_at,
        87400
    );
    assert_eq!(
        crate::grants::verify(&signed, &public, 87400, 1100)
            .err()
            .unwrap()
            .code,
        "OFFLINE_GRANT_EXPIRED"
    );
    assert_eq!(
        crate::grants::verify(&signed, &public, 1100, 1500)
            .err()
            .unwrap()
            .code,
        "CLOCK_ROLLBACK"
    );
    let mut changed = signed.clone();
    changed["payload"] = json!(URL_SAFE_NO_PAD.encode(b"tampered"));
    assert!(crate::grants::verify(&changed, &public, 1100, 1100).is_err());
    assert!(crate::grants::verify(&signed, "different-key", 1100, 1100).is_err());
}
#[test]
fn transport_restricts_credentials_to_explicit_secure_origins() {
    for endpoint in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/path",
        "https://example.com?token=secret",
        "file:///C:/secret",
    ] {
        assert!(crate::transport::endpoint(endpoint).is_err());
    }
    assert_eq!(
        crate::transport::endpoint("https://example.com").unwrap(),
        "https://example.com"
    );
    assert!(crate::transport::endpoint("http://127.0.0.1:4318").is_ok());
}
#[test]
fn sqlite_settings_constraints_and_immutable_guards_are_active() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::open(&temp.path().join("guard.sqlite")).unwrap();
    assert_eq!(
        store
            .connection
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .connection
            .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
    assert_eq!(
        store
            .connection
            .query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    let auth = store.setup("Synthetic long password").unwrap();
    let tenant = auth["tenantId"].as_str().unwrap();
    store
        .connection
        .execute("INSERT INTO books VALUES(?,'a',1,'{}')", [tenant])
        .unwrap();
    assert!(store
        .connection
        .execute(
            "INSERT INTO periods VALUES(?,'a','bad','year','2026-02-28','2026-02-01','open',1)",
            [tenant]
        )
        .is_err());
    assert!(store
        .connection
        .execute("INSERT INTO ledgers VALUES(?,'foreign','cash')", [tenant])
        .is_err());
    store
        .connection
        .execute(
            "INSERT INTO periods VALUES(?,'a','p','year','2026-01-01','2026-12-31','open',1)",
            [tenant],
        )
        .unwrap();
    store
        .connection
        .execute(
            "INSERT INTO journals VALUES(?,'a','j','p','{}',1)",
            [tenant],
        )
        .unwrap();
    assert!(store
        .connection
        .execute("DELETE FROM journals WHERE tenant=?", [tenant])
        .is_err());
    assert!(store
        .connection
        .execute("UPDATE journals SET body='{}' WHERE tenant=?", [tenant])
        .is_err());
    assert!(store
        .connection
        .execute(
            "INSERT INTO lines VALUES(?,'a','j',0,'cash','debit',1)",
            [tenant]
        )
        .is_err());
}
#[test]
fn native_real_calendar_and_canonical_amount_validation() {
    assert!(validation::date("2026-02-29").is_err());
    assert!(validation::date("2024-02-29").is_ok());
    assert!(validation::date("0000-01-01").is_err());
    for value in ["01", "1.0", "-1", "0", "9223372036854775808"] {
        assert!(validation::minor(&json!(value)).is_err());
    }
    assert_eq!(
        validation::minor(&json!("9223372036854775807")).unwrap(),
        i64::MAX
    );
}
#[test]
fn password_setup_and_session_timeout_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::open(&temp.path().join("auth.sqlite")).unwrap();
    assert!(store.setup("short").is_err());
    let auth = store.setup("Synthetic long password").unwrap();
    assert!(store.setup("Another long password").is_err());
    assert!(store.authorize("forged-token").is_err());
    assert!(store.authorize(auth["token"].as_str().unwrap()).is_err());
    let auth = store.unlock("Synthetic long password").unwrap();
    store.expire_session();
    assert!(store.authorize(auth["token"].as_str().unwrap()).is_err());
}
#[test]
fn backup_rejects_plaintext_or_unsupported_format_without_replacing_store() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::open(&temp.path().join("safe.sqlite")).unwrap();
    let auth = store.setup("Synthetic long password").unwrap();
    let token = auth["token"].as_str().unwrap();
    let path = temp.path().join("fake.erpbackup");
    std::fs::write(&path, vec![0u8; 64]).unwrap();
    assert!(recovery::restore(&mut store, token, &path, "Synthetic backup password").is_err());
    assert_eq!(store.status().unwrap()["initialized"], true);
}
