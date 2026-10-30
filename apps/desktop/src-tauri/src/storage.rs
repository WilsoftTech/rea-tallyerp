use crate::{
    error,
    validation::{self, rows, text},
    Result,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{
    fs::{File, TryLockError},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

pub const MIGRATION: &str = include_str!("../migrations/001.sql");
pub const SYNC_MIGRATION: &str = include_str!("../migrations/002_sync.sql");
pub struct Store {
    pub connection: Connection,
    session: Option<(String, Instant, String)>,
    retry_after: Option<Instant>,
    lock_path: PathBuf,
    pub cloud: Option<crate::cloud::CloudSession>,
    pub offline_clock: (Instant, u64),
}
fn acquire(path: &Path) -> Result<File> {
    let file = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    let started = Instant::now();
    loop {
        match file.try_lock() {
            Ok(())=>return Ok(file),
            Err(TryLockError::WouldBlock) if started.elapsed()<Duration::from_secs(5)=>std::thread::sleep(Duration::from_millis(10)),
            Err(TryLockError::WouldBlock)=>return Err(error("STORAGE_BUSY","Another application instance is using or restoring this vault. Retry after it completes.")),
            Err(TryLockError::Error(e))=>return Err(e.into()),
        }
    }
}
pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| error("RANDOM_UNAVAILABLE", "Secure randomness unavailable."))?;
    Ok(bytes)
}
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn password(value: &str) -> Result<()> {
    if value.chars().count() < 12 || value.len() > 1024 {
        return Err(error(
            "INVALID_PASSWORD",
            "Use a password of 12–1024 characters.",
        ));
    }
    Ok(())
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let lock_path = path.with_extension("guard");
        let _maintenance = acquire(&lock_path)?;
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;")?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 2 {
            return Err(error("SCHEMA_TOO_NEW","Database belongs to a newer application. Keep the existing files and use that version."));
        }
        if version < 2 {
            let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            // Recheck after acquiring the writer lock: two first-run processes may race.
            let current: i64 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            if current == 0 {
                tx.execute_batch(MIGRATION)?;
            }
            if current <= 1 {
                tx.execute_batch(SYNC_MIGRATION)?;
            }
            tx.commit()?;
        }
        let store = Self {
            connection,
            session: None,
            retry_after: None,
            lock_path,
            cloud: None,
            offline_clock: (Instant::now(), crate::grants::now().unwrap_or(0)),
        };
        store.check_integrity()?;
        Ok(store)
    }
    /// Hold for the entire native operation, including authentication and backup/restore.
    /// The owned handle releases the OS lock on normal return, panic or process death.
    pub fn operation_guard(&self) -> Result<File> {
        acquire(&self.lock_path)
    }
    pub fn check_integrity(&self) -> Result<()> {
        let reference = Connection::open_in_memory()?;
        reference.execute_batch(MIGRATION)?;
        reference.execute_batch(SYNC_MIGRATION)?;
        fn schema(
            connection: &Connection,
        ) -> std::result::Result<Vec<(String, String, String)>, rusqlite::Error> {
            connection.prepare("SELECT type,name,coalesce(sql,'') FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")?
                .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect()
        }
        if schema(&reference)? != schema(&self.connection)? {
            return Err(error(
                "SCHEMA_MISMATCH",
                "Database schema differs from this application. Preserve the files for recovery.",
            ));
        }
        let ok: String = self
            .connection
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        let foreign: i64 = self.connection.query_row(
            "SELECT count(*) FROM pragma_foreign_key_check",
            [],
            |r| r.get(0),
        )?;
        let unfinished: i64 = self.connection.query_row(
            "SELECT count(*) FROM journals WHERE finalized<>1",
            [],
            |r| r.get(0),
        )?;
        if ok != "ok" || foreign != 0 || unfinished != 0 {
            return Err(error(
                "INTEGRITY_ERROR",
                "Database validation failed. Keep the files and recover from a verified backup.",
            ));
        }
        let mut query = self
            .connection
            .prepare("SELECT tenant,company,state FROM books")?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (tenant, company, state) = row?;
            let state: Value = serde_json::from_str(&state)?;
            validation::validate(&state, &tenant, &company)?;
            for (table, key) in [
                ("journals", "entries"),
                ("receipts", "receipts"),
                ("audit", "audit"),
                ("outbox", "receipts"),
                ("periods", "periods"),
                ("ledgers", "ledgers"),
            ] {
                let expected = if matches!(key, "periods" | "ledgers") {
                    rows(&state["config"], key)?.len()
                } else {
                    rows(&state, key)?.len()
                };
                let actual: i64 = self.connection.query_row(
                    &format!("SELECT count(*) FROM {table} WHERE tenant=? AND company=?"),
                    params![tenant, company],
                    |r| r.get(0),
                )?;
                if actual != expected as i64 {
                    return Err(error(
                        "INTEGRITY_ERROR",
                        "Stored projections do not reconcile.",
                    ));
                }
            }
            for entry in rows(&state, "entries")? {
                let id = text(entry, "id")?;
                let body: String = self.connection.query_row(
                    "SELECT body FROM journals WHERE tenant=? AND company=? AND id=?",
                    params![tenant, company, id],
                    |r| r.get(0),
                )?;
                if serde_json::from_str::<Value>(&body)? != *entry {
                    return Err(error(
                        "INTEGRITY_ERROR",
                        "Journal projection differs from its immutable source.",
                    ));
                }
                let mut query=self.connection.prepare("SELECT ledger,side,amount FROM lines WHERE tenant=? AND company=? AND journal=? ORDER BY position")?;
                let lines = query
                    .query_map(params![tenant, company, id], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let expected = rows(entry, "lines")?;
                if lines.len() != expected.len()
                    || lines
                        .iter()
                        .zip(expected)
                        .any(|((ledger, side, amount), e)| {
                            e["ledgerId"] != *ledger
                                || e["side"] != *side
                                || validation::minor(&e["amount"]).ok() != Some(*amount)
                        })
                {
                    return Err(error("INTEGRITY_ERROR", "Journal lines do not reconcile."));
                }
            }
            for receipt in rows(&state, "receipts")? {
                let command = text(receipt, "commandId")?;
                let (body,payload):(String,String)=self.connection.query_row(
                    "SELECT r.body,o.payload FROM receipts r JOIN outbox o USING(tenant,company,command) WHERE r.tenant=? AND r.company=? AND r.command=?",
                    params![tenant,company,command],|r|Ok((r.get(0)?,r.get(1)?)))?;
                if serde_json::from_str::<Value>(&body)? != *receipt
                    || payload != text(receipt, "payload")?
                {
                    return Err(error(
                        "INTEGRITY_ERROR",
                        "Receipt and outbox do not reconcile.",
                    ));
                }
            }
            for (i, event) in rows(&state, "audit")?.iter().enumerate() {
                let body: String = self.connection.query_row(
                    "SELECT body FROM audit WHERE tenant=? AND company=? AND sequence=?",
                    params![tenant, company, i as i64],
                    |r| r.get(0),
                )?;
                if serde_json::from_str::<Value>(&body)? != *event {
                    return Err(error(
                        "INTEGRITY_ERROR",
                        "Audit projection does not reconcile.",
                    ));
                }
            }
        }
        Ok(())
    }
    pub fn status(&self) -> Result<Value> {
        let count: i64 = self
            .connection
            .query_row("SELECT count(*) FROM vault", [], |r| r.get(0))?;
        Ok(json!({"initialized":count==1,"mode":"local-only","schema":2}))
    }
    pub fn setup(&mut self, supplied: &str) -> Result<Value> {
        password(supplied)?;
        let secret = Zeroizing::new(supplied.to_owned());
        let salt = SaltString::encode_b64(&random::<16>()?)
            .map_err(|_| error("CRYPTO_ERROR", "Cannot generate password salt."))?;
        let hash = Argon2::default()
            .hash_password(secret.as_bytes(), &salt)
            .map_err(|_| error("CRYPTO_ERROR", "Cannot protect the password."))?
            .to_string();
        let tenant = format!("local-{}", hex(&random::<16>()?));
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let count: i64 = tx.query_row("SELECT count(*) FROM vault", [], |r| r.get(0))?;
        if count != 0 {
            return Err(error(
                "ALREADY_INITIALIZED",
                "Device vault already exists. Unlock it instead.",
            ));
        }
        tx.execute(
            "INSERT INTO vault VALUES(1,?,?,?)",
            params![tenant, hash, hex(&random::<16>()?)],
        )?;
        tx.commit()?;
        self.new_session(&tenant)
    }
    fn new_session(&mut self, tenant: &str) -> Result<Value> {
        let token = hex(&random::<32>()?);
        let generation: String = self.connection.query_row(
            "SELECT generation FROM vault WHERE singleton=1",
            [],
            |r| r.get(0),
        )?;
        self.session = Some((token.clone(), Instant::now(), generation));
        self.retry_after = None;
        Ok(json!({"token":token,"tenantId":tenant,"actorId":"local-owner","mode":"local-only"}))
    }
    pub fn unlock(&mut self, supplied: &str) -> Result<Value> {
        if self.retry_after.is_some_and(|until| Instant::now() < until) {
            return Err(error("UNLOCK_DELAY", "Wait before retrying the password."));
        }
        let secret = Zeroizing::new(supplied.to_owned());
        let (tenant, hash): (String, String) = self.connection.query_row(
            "SELECT tenant,password_hash FROM vault WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let valid = PasswordHash::new(&hash).ok().is_some_and(|parsed| {
            Argon2::default()
                .verify_password(secret.as_bytes(), &parsed)
                .is_ok()
        });
        if !valid {
            self.retry_after = Some(Instant::now() + Duration::from_secs(2));
            return Err(error(
                "UNLOCK_FAILED",
                "Password did not unlock this device.",
            ));
        }
        self.new_session(&tenant)
    }
    pub fn lock(&mut self) {
        self.session = None;
        self.cloud = None;
    }
    #[cfg(test)]
    pub(crate) fn expire_session(&mut self) {
        if let Some((_, at, _)) = &mut self.session {
            *at = Instant::now() - Duration::from_secs(901);
        }
    }
    pub fn authorize(&mut self, token: &str) -> Result<String> {
        if !self.session.as_ref().is_some_and(|(stored, at, _)| {
            stored == token && at.elapsed() < Duration::from_secs(900)
        }) {
            self.lock();
            return Err(error("SESSION_LOCKED", "Unlock this device to continue."));
        }
        let (tenant, generation): (String, String) = self.connection.query_row(
            "SELECT tenant,generation FROM vault WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if self.session.as_ref().unwrap().2 != generation {
            self.lock();
            return Err(error(
                "SESSION_LOCKED",
                "This vault was restored. Unlock it again before continuing.",
            ));
        }
        self.session.as_mut().unwrap().1 = Instant::now();
        Ok(tenant)
    }
    pub fn list(&mut self, token: &str) -> Result<Value> {
        let tenant = self.authorize(token)?;
        let mut query=self.connection.prepare("SELECT company,json_extract(state,'$.config.company.name') FROM books WHERE tenant=? ORDER BY company")?;
        let books = query
            .query_map([tenant], |r| {
                Ok(json!({"companyId":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?}))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(json!(books))
    }
    pub fn read(&mut self, token: &str, company: &str) -> Result<Value> {
        let tenant = self.authorize(token)?;
        let row: Option<(i64, String)> = self
            .connection
            .query_row(
                "SELECT revision,state FROM books WHERE tenant=? AND company=?",
                params![tenant, company],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (revision, state) =
            row.ok_or_else(|| error("BOOK_NOT_FOUND", "Company not found in this device vault."))?;
        Ok(json!({"revision":revision,"state":state}))
    }
    pub fn create(&mut self, token: &str, encoded: &str) -> Result<Value> {
        let tenant = self.authorize(token)?;
        if encoded.len() > 16 * 1024 * 1024 {
            return Err(error(
                "DATA_LIMIT",
                "Company data exceeds the supported command size.",
            ));
        }
        let state: Value = serde_json::from_str(encoded)?;
        let company = text(&state["config"]["company"], "companyId")?;
        validation::validate(&state, &tenant, company)?;
        if ["entries", "receipts", "audit", "drafts"]
            .iter()
            .any(|key| !state[key].as_array().is_some_and(Vec::is_empty))
            || state["chartVersion"] != 1
        {
            return Err(error(
                "INVALID_INITIAL_STATE",
                "Create an empty company; post opening balances through journals.",
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO books VALUES(?,?,1,?)",
            params![tenant, company, encoded],
        )?;
        Self::project(&tx, &tenant, company, None, &state)?;
        tx.commit()?;
        Ok(json!(null))
    }
    pub fn commit(
        &mut self,
        token: &str,
        company: &str,
        revision: i64,
        encoded: &str,
    ) -> Result<Value> {
        self.commit_with_resolution(token, company, revision, encoded, None)
    }
    pub fn commit_with_resolution(
        &mut self,
        token: &str,
        company: &str,
        revision: i64,
        encoded: &str,
        resolution: Option<(&str, &str)>,
    ) -> Result<Value> {
        let tenant = self.authorize(token)?;
        if encoded.len() > 16 * 1024 * 1024 {
            return Err(error(
                "DATA_LIMIT",
                "Company data exceeds the supported command size.",
            ));
        }
        let after: Value = serde_json::from_str(encoded)?;
        crate::cloud::require_write(self, &tenant, company, &after)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,state FROM books WHERE tenant=? AND company=?",
                params![tenant, company],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (current, old) = prior.ok_or_else(|| error("BOOK_NOT_FOUND", "Company not found."))?;
        if current != revision {
            return Err(error(
                "VERSION_CONFLICT",
                "Company changed. Refresh and retry.",
            ));
        }
        let before: Value = serde_json::from_str(&old)?;
        validation::transition(&before, &after, &tenant, company)?;
        Self::project(&tx, &tenant, company, Some(&before), &after)?;
        if let Some((mode, original)) = resolution {
            let receipt = rows(&after, "receipts")?
                .last()
                .ok_or_else(|| error("INVALID_RESOLUTION", "Resolution receipt is missing."))?;
            let command = text(receipt, "commandId")?;
            let (state,root):(String,Option<String>)=tx.query_row("SELECT state,resolution_root FROM outbox WHERE tenant=? AND company=? AND command=?",params![tenant,company,original],|r|Ok((r.get(0)?,r.get(1)?)))?;
            if !["rejected", "conflict"].contains(&state.as_str()) {
                return Err(error("INVALID_RESOLUTION","Only a durable server rejection/conflict can be resolved. Unknown responses must be retried."));
            }
            let root = root.unwrap_or(original.to_owned());
            if mode == "compensate" {
                let prior: Value = serde_json::from_str(&tx.query_row::<String, _, _>(
                    "SELECT body FROM receipts WHERE tenant=? AND company=? AND command=?",
                    params![tenant, company, original],
                    |r| r.get(0),
                )?)?;
                let linked = receipt["command"]["kind"] == "reverse"
                    && receipt["result"]["reverses"] == prior["result"]["id"];
                // Failed reversals use a general contra journal, linked through
                // resolutions; the domain prohibits reversing a reversal.
                let contra = !prior["result"]["reverses"].is_null()
                    && receipt["command"]["kind"] == "post"
                    && receipt["result"]["reverses"].is_null()
                    && receipt["result"]["intent"] == "general"
                    && text(&receipt["result"], "date")? >= text(&prior["result"], "date")?
                    && !text(&receipt["result"], "narration")?.trim().is_empty()
                    && rows(&receipt["result"], "lines")?.len()
                        == rows(&prior["result"], "lines")?.len()
                    && rows(&prior["result"], "lines")?
                        .iter()
                        .zip(rows(&receipt["result"], "lines")?)
                        .all(|(a, b)| {
                            a["ledgerId"] == b["ledgerId"]
                                && a["amount"] == b["amount"]
                                && a["side"] != b["side"]
                        });
                if (!linked && !contra) || prior["result"]["createdAt"].is_null() {
                    return Err(error("INVALID_RESOLUTION","Device compensation must be a full linked reversal of the rejected local journal."));
                }
                let canonical: Value = serde_json::from_str(&tx.query_row::<String, _, _>(
                    "SELECT canonical FROM sync_profiles WHERE tenant=? AND company=?",
                    params![tenant, company],
                    |r| r.get(0),
                )?)?;
                if rows(&canonical, "entries")?
                    .iter()
                    .any(|row| row["id"] == prior["result"]["id"])
                {
                    return Err(error(
                        "INVALID_RESOLUTION",
                        "A cloud-accepted journal must use a normal synchronized reversal.",
                    ));
                }
                tx.execute("UPDATE outbox SET local_only=1,state='not-enrolled' WHERE tenant=? AND company=? AND command=?",params![tenant,company,command])?;
                tx.execute("INSERT INTO resolutions(tenant,company,root,original_command,reversal_command,reason) VALUES(?,?,?,?,?,?)",params![tenant,company,root,original,command,text(&receipt["result"],"narration")?])?;
            } else if mode == "replace" {
                let ready:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM resolutions WHERE tenant=? AND company=? AND original_command=?)",params![tenant,company,original],|r|r.get(0))?;
                if !ready || receipt["command"]["kind"] != "post" {
                    return Err(error(
                        "INVALID_RESOLUTION",
                        "Compensate the rejected device journal before posting its replacement.",
                    ));
                }
                let accepted:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE tenant=? AND company=? AND resolution_root=? AND state='accepted')",params![tenant,company,root],|r|r.get(0))?;
                if accepted {
                    return Err(error(
                        "ALREADY_RESOLVED",
                        "This root already has an accepted replacement.",
                    ));
                }
                tx.execute("UPDATE outbox SET resolution_root=? WHERE tenant=? AND company=? AND command=?",params![root,tenant,company,command])?;
                tx.execute("UPDATE resolutions SET replacement_command=? WHERE tenant=? AND company=? AND original_command=?",params![command,tenant,company,original])?;
            } else {
                return Err(error(
                    "INVALID_RESOLUTION",
                    "Unsupported resolution action.",
                ));
            }
            crate::sync_store::event(
                &tx,
                &tenant,
                company,
                "exception-resolution",
                &format!("{mode} {original} with {command}"),
            )?;
        }
        if tx.query_row::<bool, _, _>(
            "SELECT EXISTS(SELECT 1 FROM sync_profiles WHERE tenant=? AND company=?)",
            params![tenant, company],
            |r| r.get(0),
        )? {
            tx.execute(
                "UPDATE sync_profiles SET last_seen=max(last_seen,?) WHERE tenant=? AND company=?",
                params![crate::grants::now()? as i64, tenant, company],
            )?;
        }
        tx.execute("UPDATE books SET revision=revision+1,state=? WHERE tenant=? AND company=? AND revision=?",params![encoded,tenant,company,revision])?;
        tx.commit()?;
        Ok(json!(null))
    }
    pub(crate) fn project(
        tx: &rusqlite::Transaction<'_>,
        tenant: &str,
        company: &str,
        before: Option<&Value>,
        after: &Value,
    ) -> Result<()> {
        for p in rows(&after["config"], "periods")? {
            tx.execute("INSERT INTO periods VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant,company,id) DO UPDATE SET year_id=excluded.year_id,start=excluded.start,end=excluded.end,status=excluded.status,version=excluded.version",
                params![tenant,company,text(p,"id")?,text(p,"yearId")?,text(p,"start")?,text(p,"end")?,text(p,"status")?,validation::number(p,"version")?])?;
        }
        for l in rows(&after["config"], "ledgers")? {
            tx.execute(
                "INSERT OR IGNORE INTO ledgers VALUES(?,?,?)",
                params![tenant, company, text(l, "id")?],
            )?;
        }
        let old_entries = before
            .map(|b| b["entries"].as_array().unwrap().len())
            .unwrap_or(0);
        for e in rows(after, "entries")?.iter().skip(old_entries) {
            let id = text(e, "id")?;
            tx.execute(
                "INSERT INTO journals(tenant,company,id,period_id,body) VALUES(?,?,?,?,?)",
                params![tenant, company, id, text(e, "periodId")?, e.to_string()],
            )?;
            for (i, line) in rows(e, "lines")?.iter().enumerate() {
                tx.execute(
                    "INSERT INTO lines VALUES(?,?,?,?,?,?,?)",
                    params![
                        tenant,
                        company,
                        id,
                        i as i64,
                        text(line, "ledgerId")?,
                        text(line, "side")?,
                        validation::minor(&line["amount"])?
                    ],
                )?;
            }
            tx.execute(
                "UPDATE journals SET finalized=1 WHERE tenant=? AND company=? AND id=?",
                params![tenant, company, id],
            )?;
        }
        let count = before
            .map(|b| b["receipts"].as_array().unwrap().len())
            .unwrap_or(0);
        for (sequence, receipt) in rows(after, "receipts")?.iter().enumerate().skip(count) {
            let command = text(receipt, "commandId")?;
            tx.execute(
                "INSERT INTO receipts VALUES(?,?,?,?)",
                params![tenant, company, command, receipt.to_string()],
            )?;
            tx.execute(
                "INSERT INTO outbox(tenant,company,command,payload,wire,state,sequence) VALUES(?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_profiles WHERE tenant=? AND company=?) THEN 'pending' ELSE 'not-enrolled' END,?)",
                params![tenant, company, command, text(receipt, "payload")?,receipt.get("command").map(Value::to_string),tenant,company,sequence as i64],
            )?;
        }
        let count = before
            .map(|b| b["audit"].as_array().unwrap().len())
            .unwrap_or(0);
        for (i, event) in rows(after, "audit")?.iter().enumerate().skip(count) {
            tx.execute(
                "INSERT INTO audit VALUES(?,?,?,?)",
                params![tenant, company, i as i64, event.to_string()],
            )?;
        }
        // Remove unused masters omitted by the shared model; FK constraints protect posted references.
        for (table, key) in [("periods", "periods"), ("ledgers", "ledgers")] {
            if let Some(old) = before {
                for row in rows(&old["config"], key)? {
                    if !rows(&after["config"], key)?
                        .iter()
                        .any(|next| next["id"] == row["id"])
                    {
                        tx.execute(
                            &format!("DELETE FROM {table} WHERE tenant=? AND company=? AND id=?"),
                            params![tenant, company, text(row, "id")?],
                        )?;
                    }
                }
            }
        }
        Ok(())
    }
}
