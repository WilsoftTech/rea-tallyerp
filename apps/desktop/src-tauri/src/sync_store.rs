use crate::{
    cloud::{CloudSession, Profile},
    error, grants,
    storage::{hex, random, Store},
    validation::{self, rows, text},
    Result,
};
use rusqlite::{params, Transaction, TransactionBehavior};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
pub type Shared = Arc<Mutex<Store>>;

pub fn access<T>(
    shared: &Shared,
    token: &str,
    work: impl FnOnce(&mut Store, &str) -> Result<T>,
) -> Result<T> {
    let mut store = shared.lock().map_err(|_| {
        error(
            "STORAGE_UNAVAILABLE",
            "Restart the application to recover its storage connection.",
        )
    })?;
    let _guard = store.operation_guard()?;
    let tenant = store.authorize(token)?;
    work(&mut store, &tenant)
}
pub fn connected(store: &Store, p: Option<&Profile>) -> Result<CloudSession> {
    let live = store.cloud.clone().ok_or_else(|| {
        error(
            "CLOUD_LOGIN_REQUIRED",
            "Sign in to the service to synchronize. Local records are retained.",
        )
    })?;
    if p.is_some_and(|p| p.endpoint != live.endpoint || p.user_id != live.user_id) {
        return Err(error(
            "CLOUD_LOGIN_REQUIRED",
            "Sign in with this company's enrolled service account.",
        ));
    }
    Ok(live)
}
pub fn event(
    tx: &Transaction<'_>,
    tenant: &str,
    company: &str,
    action: &str,
    detail: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO sync_events VALUES(?,?,?,?,?,?)",
        params![
            tenant,
            company,
            hex(&random::<16>()?),
            grants::now()? as i64,
            action,
            detail
        ],
    )?;
    Ok(())
}
pub fn remap(value: &Value, from: (&str, &str), to: (&str, &str)) -> Result<Value> {
    fn walk(value: &Value, from: (&str, &str), to: (&str, &str), depth: usize) -> Result<Value> {
        if depth > 32 {
            return Err(error(
                "INVALID_DATA",
                "Sync data nesting exceeds the supported bound.",
            ));
        }
        match value {
            Value::Array(items) => Ok(Value::Array(
                items
                    .iter()
                    .map(|item| walk(item, from, to, depth + 1))
                    .collect::<Result<Vec<_>>>()?,
            )),
            Value::Object(items) => {
                let mut next = serde_json::Map::new();
                for (key, item) in items {
                    next.insert(key.clone(), walk(item, from, to, depth + 1)?);
                }
                if items.contains_key("tenantId") || items.contains_key("companyId") {
                    if items.get("tenantId").and_then(Value::as_str) != Some(from.0)
                        || items.get("companyId").and_then(Value::as_str) != Some(from.1)
                    {
                        return Err(error(
                            "SCOPE_MISMATCH",
                            "Sync records belong to another scope.",
                        ));
                    }
                    next.insert("tenantId".into(), json!(to.0));
                    next.insert("companyId".into(), json!(to.1));
                }
                Ok(Value::Object(next))
            }
            _ => Ok(value.clone()),
        }
    }
    walk(value, from, to, 0)
}
pub fn same_posting(a: &Value, b: &Value) -> bool {
    [
        "id",
        "date",
        "periodId",
        "yearId",
        "intent",
        "narration",
        "currency",
        "reverses",
    ]
    .iter()
    .all(|key| a[*key] == b[*key])
        && a["lines"]
            .as_array()
            .zip(b["lines"].as_array())
            .is_some_and(|(a, b)| {
                a.len() == b.len()
                    && a.iter().zip(b).all(|(a, b)| {
                        ["ledgerId", "side", "amount", "nature"]
                            .iter()
                            .all(|key| a[*key] == b[*key])
                    })
            })
}
fn preserve_canonical(old: &Value, new: &Value) -> Result<()> {
    for key in ["entries", "receipts", "audit"] {
        let before = rows(old, key)?;
        let after = rows(new, key)?;
        if !after.starts_with(before) {
            return Err(error("CANONICAL_HISTORY_CONFLICT","Server history differs from previously accepted immutable evidence. Preserve backups and request recovery review."));
        }
    }
    if new["config"]["company"] != old["config"]["company"] {
        return Err(error(
            "CANONICAL_HISTORY_CONFLICT",
            "Registered company identity changed unexpectedly.",
        ));
    }
    Ok(())
}
fn local_masters(before: &Value, canonical: &Value, p: &Profile) -> Result<Value> {
    let config = remap(
        &canonical["config"],
        (&p.remote_tenant, &p.remote_company),
        (&p.tenant, &p.company),
    )?;
    if before["config"]["company"] != config["company"] {
        return Err(error(
            "MASTER_CONFLICT",
            "Shared company identity differs from this device.",
        ));
    }
    for key in ["years", "periods", "groups", "ledgers"] {
        for old in rows(&before["config"], key)? {
            let next = rows(&config, key)?
                .iter()
                .find(|row| row["id"] == old["id"])
                .ok_or_else(|| {
                    error(
                        "MASTER_CONFLICT",
                        "A referenced device master is absent from the cloud snapshot.",
                    )
                })?;
            let fields = match key {
                "years" => vec!["start", "end"],
                "periods" => vec!["start", "end", "yearId"],
                "groups" => vec!["parentId", "nature"],
                _ => vec!["groupId", "kind"],
            };
            if fields.iter().any(|key| old[*key] != next[*key]) {
                return Err(error(
                    "MASTER_CONFLICT",
                    "Shared master classification changed; local evidence was preserved.",
                ));
            }
        }
    }
    let mut after = before.clone();
    after["config"] = config;
    after["chartVersion"] = canonical["chartVersion"].clone();
    validation::validate(&after, &p.tenant, &p.company)?;
    Ok(after)
}
pub fn outcome(tx: &Transaction<'_>, p: &Profile, response: &Value) -> Result<()> {
    if response["protocol"] != 1 {
        return Err(error(
            "UNSUPPORTED_PROTOCOL",
            "Unsupported service outcome. Local work was retained.",
        ));
    }
    let command = text(response, "commandId")?;
    grants::identifier(command)?;
    let state = text(response, "status")?;
    if !["accepted", "rejected", "conflict"].contains(&state) {
        return Err(error(
            "INVALID_SERVICE_RESPONSE",
            "Unsupported command outcome state.",
        ));
    }
    let cursor = response["cursor"]
        .as_i64()
        .filter(|n| *n > 0 && *n <= 9_007_199_254_740_990)
        .ok_or_else(|| error("INVALID_CURSOR", "Service outcome cursor is invalid."))?;
    let source: Option<String> = tx
        .query_row(
            "SELECT body FROM receipts WHERE tenant=? AND company=? AND command=?",
            params![p.tenant, p.company, command],
            |r| r.get(0),
        )
        .optional()?;
    let known_source = source.is_some();
    let mut required_permission = None;
    if let Some(source) = source {
        let receipt: Value = serde_json::from_str(&source)?;
        required_permission = match receipt["command"]["kind"].as_str() {
            Some("post" | "post-draft") => Some("post"),
            Some("reverse") => Some("reverse"),
            Some("save-draft") => Some("draft"),
            _ => None,
        };
        if state == "accepted" && receipt["result"].get("createdAt").is_some() {
            let remote = remap(
                &response["result"],
                (&p.remote_tenant, &p.remote_company),
                (&p.tenant, &p.company),
            )?;
            if !same_posting(&receipt["result"], &remote) {
                return Err(error(
                    "CANONICAL_HISTORY_CONFLICT",
                    "Accepted journal values differ from the immutable local command.",
                ));
            }
        }
        let prior: Option<(String, Option<i64>)> = tx
            .query_row(
                "SELECT state,server_cursor FROM outbox WHERE tenant=? AND company=? AND command=?",
                params![p.tenant, p.company, command],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if prior.as_ref().is_some_and(|(old, known)| {
            known.is_some()
                && ["accepted", "rejected", "conflict"].contains(&old.as_str())
                && (old != state || *known != Some(cursor))
        }) {
            return Err(error(
                "CANONICAL_HISTORY_CONFLICT",
                "A durable command outcome changed unexpectedly.",
            ));
        }
        tx.execute("UPDATE outbox SET state=?,server_cursor=?,last_error=?,lease_owner=NULL,lease_until=0 WHERE tenant=? AND company=? AND command=?",
            params![state,cursor,response["code"].as_str(),p.tenant,p.company,command])?;
    }
    let known_intent = tx.execute("UPDATE cloud_intents SET state=?,result=?,last_error=? WHERE tenant=? AND company=? AND command=?",
        params![state,response.to_string(),response["code"].as_str(),p.tenant,p.company,command])?;
    if state != "accepted" && (known_source || known_intent > 0) {
        let pause =
            match response["code"].as_str() {
                Some("DEVICE_REVOKED") => Some("device-revoked"),
                Some("FORBIDDEN")
                    if grants::verify(&p.grant, &p.public_key, grants::now()?, p.last_seen)
                        .map_or(true, |claims| {
                            required_permission.is_none_or(|permission| {
                                claims.permissions.iter().any(|p| p == permission)
                            })
                        }) =>
                {
                    Some("access-revoked")
                }
                Some("GENERATION_CONFLICT") => Some("recovery-required"),
                _ => None,
            };
        if let Some(pause) = pause {
            tx.execute(
                "UPDATE sync_profiles SET paused=? WHERE tenant=? AND company=?",
                params![pause, p.tenant, p.company],
            )?;
        }
    }
    Ok(())
}
use rusqlite::OptionalExtension;
pub struct Snapshot<'a> {
    pub book: &'a Value,
    pub after: i64,
    pub cursor: i64,
    pub epoch: &'a str,
    pub outcomes: &'a [Value],
    pub recovery: bool,
}
pub fn apply_snapshot(store: &mut Store, p: &Profile, snapshot: Snapshot<'_>) -> Result<()> {
    let Snapshot {
        book,
        after,
        cursor,
        epoch,
        outcomes,
        recovery,
    } = snapshot;
    if epoch != p.epoch && !recovery {
        return Err(error(
            "GENERATION_CONFLICT",
            "Server generation changed. Explicit recovery review is required.",
        ));
    }
    if cursor < after && !recovery {
        return Err(error(
            "CURSOR_AHEAD",
            "Service is behind this device. No cursor was discarded.",
        ));
    }
    validation::validate_canonical(book, &p.remote_tenant, &p.remote_company)?;
    preserve_canonical(&p.canonical, book)?;
    let raw: String = store.connection.query_row(
        "SELECT state FROM books WHERE tenant=? AND company=?",
        params![p.tenant, p.company],
        |r| r.get(0),
    )?;
    let before: Value = serde_json::from_str(&raw)?;
    let local_remote = remap(
        book,
        (&p.remote_tenant, &p.remote_company),
        (&p.tenant, &p.company),
    )?;
    for entry in rows(&before, "entries")? {
        if let Some(accepted) = rows(&local_remote, "entries")?
            .iter()
            .find(|row| row["id"] == entry["id"])
        {
            if !same_posting(entry, accepted) {
                return Err(error("CANONICAL_HISTORY_CONFLICT","The same journal ID has different business values. Neither history was overwritten."));
            }
        }
    }
    let next = local_masters(&before, book, p)?;
    let tx = store
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current: i64 = tx.query_row(
        "SELECT cursor FROM sync_profiles WHERE tenant=? AND company=?",
        params![p.tenant, p.company],
        |r| r.get(0),
    )?;
    if current != after && !recovery {
        if current >= cursor {
            return Ok(());
        }
        return Err(error(
            "CURSOR_CONFLICT",
            "Another sync advanced this company. Retry from the persisted cursor.",
        ));
    }
    if next != before {
        Store::project(&tx, &p.tenant, &p.company, Some(&before), &next)?;
        tx.execute(
            "UPDATE books SET revision=revision+1,state=? WHERE tenant=? AND company=?",
            params![next.to_string(), p.tenant, p.company],
        )?;
    }
    for row in outcomes {
        outcome(&tx, p, row)?;
    }
    tx.execute("UPDATE sync_profiles SET canonical=?,cursor=?,epoch=?,last_online=?,last_seen=max(last_seen,?) WHERE tenant=? AND company=?",
        params![book.to_string(),cursor,epoch,grants::now()? as i64,grants::now()? as i64,p.tenant,p.company])?;
    event(
        &tx,
        &p.tenant,
        &p.company,
        if recovery {
            "recovery-snapshot"
        } else {
            "canonical-pull"
        },
        &format!("cursor {cursor}"),
    )?;
    tx.commit()?;
    Ok(())
}
pub fn failure(shared: &Shared, token: &str, company: &str, problem: &crate::Error) {
    let _ = access(shared, token, |store, tenant| {
        let pause = match problem.code.as_str() {
            "FORBIDDEN" => Some("access-revoked"),
            "DEVICE_REVOKED" => Some("device-revoked"),
            "CANONICAL_HISTORY_CONFLICT" => Some("history-conflict"),
            "GENERATION_CONFLICT" | "CURSOR_AHEAD" | "CURSOR_GAP" | "MASTER_CONFLICT" => {
                Some("recovery-required")
            }
            _ => None,
        };
        if problem.code == "AUTHENTICATION_FAILED" {
            store.cloud = None;
        }
        let tx = store.connection.transaction()?;
        if let Some(paused) = pause {
            tx.execute(
                "UPDATE sync_profiles SET paused=? WHERE tenant=? AND company=?",
                params![paused, tenant, company],
            )?;
        }
        event(&tx, tenant, company, "sync-error", &problem.code)?;
        tx.commit()?;
        Ok(())
    });
}
