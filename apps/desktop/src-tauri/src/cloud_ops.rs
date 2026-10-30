//! Native-only network coordinator. No network request runs while holding the vault/SQLite lock.
use crate::{
    cloud::{self, CloudSession, Profile},
    error, grants,
    storage::{hex, random, Store},
    sync_store::{self, access, connected, Shared},
    transport,
    validation::{self, rows, text},
    Result,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use zeroize::Zeroizing;

fn generation(store: &Store) -> Result<String> {
    Ok(store
        .connection
        .query_row("SELECT generation FROM vault WHERE singleton=1", [], |r| {
            r.get(0)
        })?)
}
fn fresh() -> Result<String> {
    Ok(hex(&random::<16>()?))
}
fn request(live: &CloudSession, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
    transport::request(&live.endpoint, Some(&live.token), method, path, body)
}
fn number(v: &Value, key: &str) -> Result<i64> {
    validation::number(v, key)
}
fn bound_grant(p: &Profile, signed: &Value) -> Result<grants::Claims> {
    let c = grants::verify(signed, &p.public_key, grants::now()?, p.last_seen)?;
    if c.user_id != p.user_id
        || c.tenant_id != p.remote_tenant
        || c.company_id != p.remote_company
        || c.source_tenant != p.tenant
        || c.source_company != p.company
        || c.device_id != p.device_id
        || c.generation != p.generation
        || c.epoch != p.epoch
    {
        return Err(error(
            "UNTRUSTED_GRANT",
            "Service authority is bound to another company, user or device.",
        ));
    }
    Ok(c)
}
fn get_profile(store: &Store, tenant: &str, company: &str) -> Result<Profile> {
    cloud::profile(store, tenant, company)?
        .ok_or_else(|| error("NOT_ENROLLED", "This company is local-only."))
}

pub fn dispatch(shared: &Shared, op: &str, payload: &Value) -> Result<Value> {
    let token = text(payload, "token")?;
    let company = payload["companyId"].as_str().unwrap_or("");
    let result = match op {
        "cloud_status" => status(shared, token, company),
        "cloud_login" => login(shared, token, payload),
        "cloud_logout" => logout(shared, token),
        "cloud_companies" => {
            let tenant = text(payload, "remoteTenant")?;
            grants::identifier(tenant)?;
            let live = access(shared, token, |s, _| connected(s, None))?;
            request(
                &live,
                "GET",
                &format!("/v1/tenants/{tenant}/companies"),
                None,
            )
        }
        "cloud_enroll" => enroll(shared, token, payload),
        "cloud_cancel_enrollment" => cancel_enrollment(shared, token, payload),
        "cloud_join" => join(shared, token, payload),
        "cloud_sync" => synchronize(shared, token, company),
        "cloud_designate_compensation" => designate(shared, token, company, payload),
        "cloud_command" => master(shared, token, company, &payload["command"]),
        "cloud_retry_master" => {
            let wire = access(shared, token, |s, t| {
                let encoded: String = s.connection.query_row(
                    "SELECT wire FROM cloud_intents WHERE tenant=? AND company=? AND command=?",
                    params![t, company, text(payload, "commandId")?],
                    |r| r.get(0),
                )?;
                Ok(serde_json::from_str::<Value>(&encoded)?)
            })?;
            master(shared, token, company, &wire)
        }
        "cloud_recover" => recover(shared, token, company, payload["confirmed"] == true),
        _ => Err(error(
            "UNSUPPORTED_OPERATION",
            "Unsupported cloud operation.",
        )),
    };
    if let Err(problem) = &result {
        if !company.is_empty() {
            sync_store::failure(shared, token, company, problem);
        }
    }
    result
}
fn login(shared: &Shared, token: &str, p: &Value) -> Result<Value> {
    access(shared, token, |_, _| Ok(()))?;
    let endpoint = transport::endpoint(text(p, "endpoint")?)?;
    let endpoint = endpoint.as_str().trim_end_matches('/').to_string();
    let result = transport::request(
        &endpoint,
        None,
        "POST",
        "/v1/auth/login",
        Some(&json!({"username":text(p,"username")?,"password":text(p,"password")?})),
    )?;
    let user = text(&result, "userId")?.to_string();
    grants::identifier(&user)?;
    let bearer = text(&result, "token")?.to_string();
    if bearer.len() > 256 {
        return Err(error("INVALID_SERVICE_RESPONSE", "Invalid session token."));
    }
    access(shared, token, |store, _| {
        store.connection.execute(
            "UPDATE sync_profiles SET paused='signed-out' WHERE endpoint<>? OR user_id<>?",
            params![endpoint, user],
        )?;
        store.cloud = Some(CloudSession {
            endpoint: endpoint.clone(),
            token: Zeroizing::new(bearer),
            user_id: user.clone(),
            tenants: result["tenants"].clone(),
        });
        Ok(json!({"userId":user,"tenants":result["tenants"],"endpoint":endpoint}))
    })
}
fn logout(shared: &Shared, token: &str) -> Result<Value> {
    let live = access(shared, token, |s, _| {
        let previous = s.cloud.take();
        s.connection
            .execute("UPDATE sync_profiles SET paused='signed-out'", [])?;
        Ok(previous)
    })?;
    if let Some(live) = live {
        let _ = request(&live, "POST", "/v1/auth/logout", Some(&json!({})));
    }
    Ok(json!(null))
}
fn status(shared: &Shared, token: &str, company: &str) -> Result<Value> {
    access(shared, token, |s, tenant| {
        let live = s
            .cloud
            .as_ref()
            .map(|l| json!({"userId":l.user_id,"endpoint":l.endpoint,"tenants":l.tenants}));
        let Some(p) = cloud::profile(s, tenant, company)? else {
            let pending:Option<(String,String,String,String)>=s.connection.query_row("SELECT enrollment_id,endpoint,remote_tenant,payload FROM enrollment_intents WHERE tenant=? AND company=? AND state='pending'",params![tenant,company],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
            let pending = if let Some((id, endpoint, remote, body)) = pending {
                let body: Value = serde_json::from_str(&body)?;
                json!({"id":id,"endpoint":endpoint,"remoteTenant":remote,"book":body["book"]})
            } else {
                Value::Null
            };
            return Ok(json!({"enrolled":false,"session":live,"pendingEnrollment":pending}));
        };
        let authority = cloud::permissions(s, &p);
        let (permissions, expires, authority_error) = match authority {
            Ok(c) => (json!(c.permissions), json!(c.expires_at), Value::Null),
            Err(e) => (
                json!([]),
                Value::Null,
                json!({"code":e.code,"message":e.message}),
            ),
        };
        let mut q=s.connection.prepare("SELECT command,state,last_error,server_cursor,resolution_root,local_only FROM outbox WHERE tenant=? AND company=? ORDER BY sequence")?;
        let commands=q.query_map(params![tenant,company],|r|Ok(json!({"commandId":r.get::<_,String>(0)?,"state":r.get::<_,String>(1)?,"code":r.get::<_,Option<String>>(2)?,"cursor":r.get::<_,Option<i64>>(3)?,"replaces":r.get::<_,Option<String>>(4)?,"localOnly":r.get::<_,i64>(5)?==1})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let mut q=s.connection.prepare("SELECT command,state,last_error FROM cloud_intents WHERE tenant=? AND company=? ORDER BY command")?;
        let intents=q.query_map(params![tenant,company],|r|Ok(json!({"commandId":r.get::<_,String>(0)?,"state":r.get::<_,String>(1)?,"code":r.get::<_,Option<String>>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let mut q=s.connection.prepare("SELECT original_command,reversal_command,replacement_command,root FROM resolutions WHERE tenant=? AND company=? ORDER BY original_command")?;
        let resolutions=q.query_map(params![tenant,company],|r|Ok(json!({"originalCommand":r.get::<_,String>(0)?,"compensation":r.get::<_,String>(1)?,"replacement":r.get::<_,Option<String>>(2)?,"root":r.get::<_,String>(3)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(
            json!({"enrolled":true,"session":live,"endpoint":p.endpoint,"remoteTenant":p.remote_tenant,"remoteCompany":p.remote_company,"cursor":p.cursor,"canonical":p.canonical,"paused":p.paused,"permissions":permissions,"expiresAt":expires,"authorityError":authority_error,"commands":commands,"intents":intents,"resolutions":resolutions}),
        )
    })
}
fn install(tx: &rusqlite::Transaction<'_>, p: &Profile, book: &Value) -> Result<()> {
    bound_grant(p, &p.grant)?;
    validation::validate_canonical(book, &p.remote_tenant, &p.remote_company)?;
    let now = grants::now()? as i64;
    tx.execute("INSERT INTO sync_profiles(tenant,company,endpoint,remote_tenant,remote_company,user_id,device_id,generation,epoch,public_key,offline_grant,cursor,canonical,paused,last_seen,last_online) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)",
        params![p.tenant,p.company,p.endpoint,p.remote_tenant,p.remote_company,p.user_id,p.device_id,p.generation,p.epoch,p.public_key,p.grant.to_string(),p.cursor,book.to_string(),now,now])?;
    sync_store::event(
        tx,
        &p.tenant,
        &p.company,
        "enrolled",
        "Reviewed cloud binding and signing key pinned",
    )?;
    Ok(())
}
fn response_profile(
    live: &CloudSession,
    tenant: &str,
    company: &str,
    device: &str,
    generation: &str,
    r: &Value,
) -> Result<Profile> {
    if r["protocol"] != 1 {
        return Err(error(
            "UNSUPPORTED_PROTOCOL",
            "Unsupported enrollment protocol.",
        ));
    }
    let p = Profile {
        tenant: tenant.into(),
        company: company.into(),
        endpoint: live.endpoint.clone(),
        remote_tenant: text(r, "tenantId")?.into(),
        remote_company: text(r, "companyId")?.into(),
        user_id: live.user_id.clone(),
        device_id: device.into(),
        generation: generation.into(),
        epoch: text(r, "epoch")?.into(),
        public_key: text(&r["grant"], "publicKey")?.into(),
        grant: r["grant"].clone(),
        cursor: number(r, "cursor")?,
        canonical: r["book"].clone(),
        paused: None,
        last_seen: 0,
    };
    bound_grant(&p, &p.grant)?;
    Ok(p)
}
fn enroll(shared: &Shared, token: &str, input: &Value) -> Result<Value> {
    if input["confirmed"] != true {
        return Err(error(
            "REVIEW_REQUIRED",
            "Review the company, balances and historical import before enrollment.",
        ));
    }
    let company = text(input, "companyId")?;
    let remote = text(input, "remoteTenant")?;
    grants::identifier(remote)?;
    let (live, tenant, body) = access(shared, token, |s, tenant| {
        let live = connected(s, None)?;
        if cloud::profile(s, tenant, company)?.is_some() {
            return Err(error(
                "ALREADY_ENROLLED",
                "Company is already enrolled. Synchronize or recover it.",
            ));
        }
        let prior:Option<(String,String,String)>=s.connection.query_row("SELECT endpoint,remote_tenant,payload FROM enrollment_intents WHERE tenant=? AND company=?",params![tenant,company],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        if let Some((endpoint, previous, body)) = prior {
            if endpoint != live.endpoint || previous != remote {
                return Err(error(
                    "ENROLLMENT_PENDING",
                    "Retry the original enrollment target before changing it.",
                ));
            }
            return Ok((
                live,
                tenant.to_owned(),
                serde_json::from_str::<Value>(&body)?,
            ));
        }
        let snapshot = s.read(token, company)?;
        let book: Value = serde_json::from_str(text(&snapshot, "state")?)?;
        let id = fresh()?;
        let device = fresh()?;
        let generation = generation(s)?;
        let body = json!({"protocol":1,"enrollmentId":id,"deviceId":device,"generation":generation,"sourceTenant":tenant,"sourceCompany":company,"confirmed":true,"book":book});
        s.connection.execute(
            "INSERT INTO enrollment_intents VALUES(?,?,?,?,?,?,?,?,'pending')",
            params![
                tenant,
                company,
                live.endpoint,
                remote,
                id,
                device,
                generation,
                body.to_string()
            ],
        )?;
        Ok((live, tenant.to_owned(), body))
    })?;
    let response = request(
        &live,
        "POST",
        &format!("/v1/tenants/{remote}/companies"),
        Some(&body),
    )?;
    let p = response_profile(
        &live,
        &tenant,
        company,
        text(&body, "deviceId")?,
        text(&body, "generation")?,
        &response,
    )?;
    if p.remote_tenant != remote || p.remote_company != company {
        return Err(error(
            "SCOPE_MISMATCH",
            "Enrollment response differs from the reviewed target.",
        ));
    }
    access(shared, token, |s, _| {
        connected(s, None)?;
        if generation(s)? != p.generation {
            return Err(error(
                "RESTORED_DEVICE",
                "Vault was restored during enrollment. Reconcile recovery.",
            ));
        }
        let existing = cloud::profile(s, &tenant, company)?;
        if existing
            .as_ref()
            .is_some_and(|old| old.device_id != p.device_id || old.public_key != p.public_key)
        {
            return Err(error(
                "DEVICE_CONFLICT",
                "Enrollment binding changed while the request was in flight.",
            ));
        }
        // The imported snapshot is fixed before HTTP. Newer device commands remain pending.
        let tx = s
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if existing.is_none() {
            install(&tx, &p, &response["book"])?;
        }
        for receipt in rows(&body["book"], "receipts")? {
            tx.execute("UPDATE outbox SET state='accepted',server_cursor=1 WHERE tenant=? AND company=? AND command=?",params![tenant,company,text(receipt,"commandId")?])?;
        }
        tx.execute("UPDATE outbox SET state='pending' WHERE tenant=? AND company=? AND state='not-enrolled' AND local_only=0",params![tenant,company])?;
        tx.execute(
            "UPDATE enrollment_intents SET state='accepted' WHERE tenant=? AND company=?",
            params![tenant, company],
        )?;
        tx.commit()?;
        Ok(())
    })?;
    status(shared, token, company)
}
fn cancel_enrollment(shared: &Shared, token: &str, input: &Value) -> Result<Value> {
    if input["confirmed"] != true {
        return Err(error(
            "REVIEW_REQUIRED",
            "Confirm cancellation of the original pending import.",
        ));
    }
    let company = text(input, "companyId")?;
    let reason = text(input, "reason")?;
    let (live, tenant, id, remote) = access(shared, token, |s, t| {
        let live = connected(s, None)?;
        let (id,endpoint,remote):(String,String,String)=s.connection.query_row("SELECT enrollment_id,endpoint,remote_tenant FROM enrollment_intents WHERE tenant=? AND company=? AND state='pending'",params![t,company],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        if endpoint != live.endpoint {
            return Err(error(
                "CLOUD_LOGIN_REQUIRED",
                "Sign in to the original enrollment service before cancellation.",
            ));
        }
        Ok((live, t.to_owned(), id, remote))
    })?;
    let response = request(
        &live,
        "POST",
        &format!("/v1/tenants/{remote}/enrollments/{id}/cancel"),
        Some(&json!({"confirmed":true,"reason":reason})),
    )?;
    if response["cancelled"] != true || response["enrollmentId"] != id {
        return Err(error(
            "INVALID_SERVICE_RESPONSE",
            "Cancellation was not acknowledged for the original enrollment.",
        ));
    }
    access(shared, token, |s, _| {
        let current = connected(s, None)?;
        if current.user_id != live.user_id || current.endpoint != live.endpoint {
            return Err(error(
                "CLOUD_LOGIN_REQUIRED",
                "The signed-in service account changed during cancellation.",
            ));
        }
        let tx = s.connection.transaction()?;
        tx.execute("DELETE FROM enrollment_intents WHERE tenant=? AND company=? AND enrollment_id=? AND state='pending'",params![tenant,company,id])?;
        sync_store::event(&tx, &tenant, company, "enrollment-cancelled", reason)?;
        tx.commit()?;
        Ok(json!(null))
    })
}
fn join(shared: &Shared, token: &str, input: &Value) -> Result<Value> {
    if input["confirmed"] != true {
        return Err(error(
            "REVIEW_REQUIRED",
            "Confirm joining an existing cloud company as a separate device book.",
        ));
    }
    let remote = text(input, "remoteTenant")?;
    let company = text(input, "remoteCompany")?;
    grants::identifier(remote)?;
    grants::identifier(company)?;
    let (live, tenant, local, device, generation) = access(shared, token, |s, tenant| {
        let live = connected(s, None)?;
        let existing:Option<String>=s.connection.query_row("SELECT company FROM sync_profiles WHERE tenant=? AND endpoint=? AND remote_tenant=? AND remote_company=? AND user_id=?",params![tenant,live.endpoint,remote,company,live.user_id],|r|r.get(0)).optional()?;
        if existing.is_some() {
            return Err(error(
                "ALREADY_ENROLLED",
                "This service/company is already linked on this device.",
            ));
        }
        let prior:Option<(String,String,String)>=s.connection.query_row("SELECT local_company,device_id,generation FROM join_intents WHERE tenant=? AND endpoint=? AND remote_tenant=? AND remote_company=? AND user_id=?",params![tenant,live.endpoint,remote,company,live.user_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let (local, device, g) = prior.unwrap_or((fresh()?, fresh()?, generation(s)?));
        s.connection.execute(
            "INSERT OR IGNORE INTO join_intents VALUES(?,?,?,?,?,?,?,?)",
            params![
                tenant,
                live.endpoint,
                remote,
                company,
                live.user_id,
                local,
                device,
                g
            ],
        )?;
        Ok((live, tenant.to_owned(), local, device, g))
    })?;
    let path = format!("/v1/tenants/{remote}/companies/{company}/join");
    let response = request(
        &live,
        "POST",
        &path,
        Some(
            &json!({"deviceId":device,"generation":generation,"sourceTenant":tenant,"sourceCompany":local,"confirmed":true}),
        ),
    )?;
    let p = response_profile(&live, &tenant, &local, &device, &generation, &response)?;
    if p.remote_tenant != remote || p.remote_company != company {
        return Err(error(
            "SCOPE_MISMATCH",
            "Joined company differs from the requested company.",
        ));
    }
    access(shared, token, |s, _| {
        connected(s, None)?;
        if generation_of(s)? != generation {
            return Err(error(
                "RESTORED_DEVICE",
                "Vault generation changed while joining.",
            ));
        }
        let config = sync_store::remap(
            &response["book"]["config"],
            (remote, company),
            (&tenant, &local),
        )?;
        let book = json!({"config":config,"chartVersion":response["book"]["chartVersion"],"entries":[],"drafts":[],"receipts":[],"audit":[]});
        validation::validate(&book, &tenant, &local)?;
        let tx = s.connection.transaction()?;
        tx.execute(
            "INSERT INTO books VALUES(?,?,1,?)",
            params![tenant, local, book.to_string()],
        )?;
        Store::project(&tx, &tenant, &local, None, &book)?;
        install(&tx, &p, &response["book"])?;
        tx.commit()?;
        Ok(())
    })?;
    Ok(json!({"companyId":local}))
}
fn generation_of(s: &Store) -> Result<String> {
    generation(s)
}

fn refresh(shared: &Shared, token: &str, company: &str) -> Result<()> {
    let (live, p) = access(shared, token, |s, t| {
        let p = get_profile(s, t, company)?;
        Ok((connected(s, Some(&p))?, p))
    })?;
    let signed = request(
        &live,
        "POST",
        &p.path("/grant"),
        Some(&json!({"deviceId":p.device_id,"generation":p.generation})),
    )?;
    let claims = grants::verify(&signed, &p.public_key, grants::now()?, p.last_seen)?;
    if claims.epoch != p.epoch {
        return Err(error(
            "GENERATION_CONFLICT",
            "Server generation changed. Explicit recovery reconciliation is required.",
        ));
    }
    bound_grant(&p, &signed)?;
    access(shared, token, |s, t| {
        let current = get_profile(s, t, company)?;
        connected(s, Some(&current))?;
        if generation(s)? != p.generation || current.device_id != p.device_id {
            return Err(error(
                "RESTORED_DEVICE",
                "Device identity changed during renewal.",
            ));
        }
        // Restores and history conflicts require the explicit recovery operation.
        if current
            .paused
            .as_deref()
            .is_some_and(|v| ["restored", "recovery-required", "history-conflict"].contains(&v))
        {
            return Err(error(
                "SYNC_REVIEW_REQUIRED",
                "Use reviewed recovery before resuming this company.",
            ));
        }
        s.connection.execute("UPDATE sync_profiles SET offline_grant=?,paused=NULL,last_seen=max(last_seen,?),last_online=? WHERE tenant=? AND company=?",params![signed.to_string(),grants::now()? as i64,grants::now()? as i64,t,company])?;
        Ok(())
    })
}
fn pull(shared: &Shared, token: &str, company: &str) -> Result<()> {
    for _ in 0..100 {
        let (live, p) = access(shared, token, |s, t| {
            let p = get_profile(s, t, company)?;
            Ok((connected(s, Some(&p))?, p))
        })?;
        let response = request(
            &live,
            "GET",
            &p.path(&format!(
                "/changes?after={}&epoch={}&limit=20",
                p.cursor, p.epoch
            )),
            None,
        )?;
        if response["protocol"] != 1 || number(&response, "after")? != p.cursor {
            return Err(error(
                "INVALID_SERVICE_RESPONSE",
                "Change feed does not match the requested protocol/cursor.",
            ));
        }
        let cursor = number(&response, "cursor")?;
        let epoch = text(&response, "epoch")?;
        let outcomes = rows(&response, "outcomes")?;
        access(shared, token, |s, t| {
            let current = get_profile(s, t, company)?;
            connected(s, Some(&current))?;
            if generation(s)? != p.generation {
                return Err(error(
                    "RESTORED_DEVICE",
                    "Device changed during synchronization.",
                ));
            }
            sync_store::apply_snapshot(
                s,
                &p,
                sync_store::Snapshot {
                    book: &response["book"],
                    after: p.cursor,
                    cursor,
                    epoch,
                    outcomes,
                    recovery: false,
                },
            )
        })?;
        if response["hasMore"] == false {
            return Ok(());
        }
        if cursor <= p.cursor {
            return Err(error("CURSOR_GAP", "Change feed did not advance."));
        }
    }
    Err(error(
        "SYNC_BATCH_LIMIT",
        "More changes remain; synchronize again to continue from the saved cursor.",
    ))
}
fn dependencies(store: &Store, p: &Profile, wire: &Value) -> Result<Value> {
    let target = match wire["kind"].as_str() {
        Some("reverse") => wire["originalId"].as_str(),
        Some("post-draft") => wire["draftId"].as_str(),
        _ => None,
    };
    let mut found = Vec::new();
    if let Some(target) = target {
        let state: Value = serde_json::from_str(&store.connection.query_row::<String, _, _>(
            "SELECT state FROM books WHERE tenant=? AND company=?",
            params![p.tenant, p.company],
            |r| r.get(0),
        )?)?;
        for receipt in rows(&state, "receipts")? {
            if receipt["result"]["id"] == target
                && (wire["kind"] != "post-draft"
                    || receipt["result"]["version"] == wire["expectedDraftVersion"])
            {
                found.push(receipt["commandId"].clone());
            }
        }
    }
    Ok(json!(found))
}
fn envelope(store: &Store, p: &Profile, wire: Value, replaces: Option<String>) -> Result<Value> {
    Ok(
        json!({"protocol":1,"deviceId":p.device_id,"generation":p.generation,"epoch":p.epoch,"dependencies":dependencies(store,p,&wire)?,"command":wire,"replaces":replaces}),
    )
}
fn synchronize(shared: &Shared, token: &str, company: &str) -> Result<Value> {
    refresh(shared, token, company)?;
    pull(shared, token, company)?;
    let owner = fresh()?;
    access(shared, token, |s, t| {
        let now = grants::now()? as i64;
        let changed=s.connection.execute("UPDATE sync_profiles SET lease_owner=?,lease_until=? WHERE tenant=? AND company=? AND lease_until<=?",params![owner,now+60,t,company,now])?;
        if changed != 1 {
            return Err(error(
                "SYNC_BUSY",
                "Another synchronization is active. Retry after its lease expires.",
            ));
        }
        Ok(())
    })?;
    let result = (|| -> Result<()> {
        for _ in 0..100 {
            let next = access(shared, token, |s, t| {
                let p = get_profile(s, t, company)?;
                let live = connected(s, Some(&p))?;
                cloud::permissions(s, &p)?;
                let now = grants::now()? as i64;
                let lease: Option<String> = s.connection.query_row(
                    "SELECT lease_owner FROM sync_profiles WHERE tenant=? AND company=?",
                    params![t, company],
                    |r| r.get(0),
                )?;
                if lease.as_deref() != Some(&owner) {
                    return Err(error(
                        "SYNC_BUSY",
                        "Delivery lease changed; the persisted queue remains intact.",
                    ));
                }
                let next:Option<(String,Option<String>,Option<String>,i64)>=s.connection.query_row("SELECT command,wire,resolution_root,attempts FROM outbox WHERE tenant=? AND company=? AND local_only=0 AND (state='pending' OR (state='sending' AND lease_until<=?)) ORDER BY sequence LIMIT 1",params![t,company,now],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
                let Some((command, wire, replaces, attempts)) = next else {
                    return Ok(None);
                };
                let due: i64 = s.connection.query_row(
                    "SELECT next_attempt FROM outbox WHERE tenant=? AND company=? AND command=?",
                    params![t, company, command],
                    |r| r.get(0),
                )?;
                if due > now {
                    return Ok(None);
                }
                let Some(wire) = wire else {
                    return Err(error("WIRE_COMMAND_REQUIRED","An old command needs reviewed import; its financial payload was not reconstructed."));
                };
                let packet = envelope(s, &p, serde_json::from_str(&wire)?, replaces)?;
                let tx = s.connection.transaction()?;
                tx.execute("UPDATE sync_profiles SET lease_until=? WHERE tenant=? AND company=? AND lease_owner=?",params![now+60,t,company,owner])?;
                tx.execute("UPDATE outbox SET state='sending',attempts=attempts+1,lease_owner=?,lease_until=? WHERE tenant=? AND company=? AND command=?",params![owner,now+60,t,company,command])?;
                tx.commit()?;
                Ok(Some((live, p, command, packet, attempts)))
            })?;
            let Some((live, p, command, packet, attempts)) = next else {
                break;
            };
            let response = request(&live, "POST", &p.path("/commands"), Some(&packet));
            match response {
                Ok(response) => {
                    access(shared, token, |s, t| {
                        if text(&response, "commandId")? != command {
                            return Err(error(
                                "INVALID_SERVICE_RESPONSE",
                                "Acknowledgment belongs to a different command.",
                            ));
                        }
                        let current = get_profile(s, t, company)?;
                        connected(s, Some(&current))?;
                        if generation(s)? != p.generation {
                            return Err(error(
                                "RESTORED_DEVICE",
                                "Vault changed before acknowledgment.",
                            ));
                        }
                        let tx = s.connection.transaction()?;
                        let lease:Option<String>=tx.query_row("SELECT lease_owner FROM outbox WHERE tenant=? AND company=? AND command=?",params![t,company,command],|r|r.get(0))?;
                        if lease.as_deref() != Some(&owner) {
                            return Err(error("SYNC_BUSY","Delivery lease changed before acknowledgment. Receipt will be reconciled on retry."));
                        }
                        sync_store::outcome(&tx, &p, &response)?;
                        sync_store::event(
                            &tx,
                            t,
                            company,
                            "command-outcome",
                            &format!("{} {}", command, text(&response, "status")?),
                        )?;
                        tx.commit()?;
                        Ok(())
                    })?
                }
                Err(problem) => {
                    access(shared, token, |s, t| {
                        let delay = problem
                            .retry_after
                            .unwrap_or(2_u64.pow((attempts as u32 + 1).min(6)))
                            .min(300) as i64;
                        s.connection.execute("UPDATE outbox SET state='pending',next_attempt=?,last_error=?,lease_owner=NULL,lease_until=0 WHERE tenant=? AND company=? AND command=? AND lease_owner=?",params![grants::now()? as i64+delay,problem.code,t,company,command,owner])?;
                        Ok(())
                    })?;
                    return Err(problem);
                }
            }
        }
        pull(shared, token, company)
    })();
    let _ = access(shared, token, |s, t| {
        s.connection.execute("UPDATE sync_profiles SET lease_owner=NULL,lease_until=0 WHERE tenant=? AND company=? AND lease_owner=?",params![t,company,owner])?;
        Ok(())
    });
    result?;
    status(shared, token, company)
}
fn designate(shared: &Shared, token: &str, company: &str, input: &Value) -> Result<Value> {
    let original = text(input, "originalCommand")?;
    let reversal = text(input, "reversalCommand")?;
    let reason = text(input, "reason")?;
    if reason.trim().is_empty() || reason.len() > 2000 {
        return Err(error(
            "REASON_REQUIRED",
            "A bounded resolution reason is required.",
        ));
    }
    access(shared, token, |s, t| {
        let p = get_profile(s, t, company)?;
        let claims = cloud::permissions(s, &p)?;
        if !claims.permissions.iter().any(|v| v == "reverse") {
            return Err(error("FORBIDDEN", "Reversal permission is required."));
        }
        let read = |id: &str| -> Result<(String, Option<String>, Value)> {
            let (state,root,body):(String,Option<String>,String)=s.connection.query_row("SELECT o.state,o.resolution_root,r.body FROM outbox o JOIN receipts r USING(tenant,company,command) WHERE o.tenant=? AND o.company=? AND o.command=?",params![t,company,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
            Ok((state, root, serde_json::from_str(&body)?))
        };
        let (a, root, original_receipt) = read(original)?;
        let (b, _, reversed) = read(reversal)?;
        if !["rejected", "conflict"].contains(&a.as_str())
            || !["rejected", "conflict"].contains(&b.as_str())
            || reversed["command"]["kind"] != "reverse"
            || reversed["result"]["reverses"] != original_receipt["result"]["id"]
            || original_receipt["result"]["createdAt"].is_null()
            || rows(&p.canonical, "entries")?.iter().any(|e| {
                e["id"] == original_receipt["result"]["id"] || e["id"] == reversed["result"]["id"]
            })
        {
            return Err(error("INVALID_RESOLUTION","Both commands must be durable cloud exceptions and an exact full local reversal, absent from accepted history."));
        }
        let tx = s.connection.transaction()?;
        tx.execute(
            "UPDATE outbox SET local_only=1 WHERE tenant=? AND company=? AND command=?",
            params![t, company, reversal],
        )?;
        tx.execute("INSERT OR IGNORE INTO resolutions(tenant,company,root,original_command,reversal_command,reason) VALUES(?,?,?,?,?,?)",params![t,company,root.unwrap_or(original.into()),original,reversal,reason])?;
        sync_store::event(&tx, t, company, "designated-device-compensation", reason)?;
        tx.commit()?;
        Ok(json!(null))
    })
}
fn master(shared: &Shared, token: &str, company: &str, wire: &Value) -> Result<Value> {
    let kind = text(wire, "kind")?;
    if !["replace-chart", "period-status", "extend-calendar"].contains(&kind) {
        return Err(error(
            "INVALID_COMMAND",
            "Only shared master commands use this online endpoint.",
        ));
    }
    let command = text(wire, "commandId")?;
    grants::identifier(command)?;
    refresh(shared, token, company)?;
    pull(shared, token, company)?;
    let (live, p, packet) = access(shared, token, |s, t| {
        let p = get_profile(s, t, company)?;
        let live = connected(s, Some(&p))?;
        let prior: Option<String> = s
            .connection
            .query_row(
                "SELECT wire FROM cloud_intents WHERE tenant=? AND company=? AND command=?",
                params![t, company, command],
                |r| r.get(0),
            )
            .optional()?;
        if prior
            .as_ref()
            .is_some_and(|prior| serde_json::from_str::<Value>(prior).ok().as_ref() != Some(wire))
        {
            return Err(error(
                "IDEMPOTENCY_CONFLICT",
                "Retry this command ID with its original payload.",
            ));
        }
        s.connection.execute("INSERT OR IGNORE INTO cloud_intents(tenant,company,command,wire,state) VALUES(?,?,?,?,'pending')",params![t,company,command,wire.to_string()])?;
        let packet = envelope(s, &p, wire.clone(), None)?;
        Ok((live, p, packet))
    })?;
    let response = request(&live, "POST", &p.path("/commands"), Some(&packet))?;
    access(shared, token, |s, t| {
        let p = get_profile(s, t, company)?;
        connected(s, Some(&p))?;
        let tx = s.connection.transaction()?;
        sync_store::outcome(&tx, &p, &response)?;
        tx.commit()?;
        Ok(())
    })?;
    pull(shared, token, company)?;
    if response["status"] != "accepted" {
        return Err(error(
            response["code"].as_str().unwrap_or("COMMAND_REJECTED"),
            response["message"]
                .as_str()
                .unwrap_or("Shared master change was rejected."),
        ));
    }
    Ok(response["result"].clone())
}
fn recover(shared: &Shared, token: &str, company: &str, confirmed: bool) -> Result<Value> {
    if !confirmed {
        return Err(error(
            "REVIEW_REQUIRED",
            "Preserve a backup and confirm device recovery reconciliation.",
        ));
    }
    let (live, mut p) = access(shared, token, |s, t| {
        let mut p = get_profile(s, t, company)?;
        let live = connected(s, Some(&p))?;
        p.generation = generation(s)?;
        Ok((live, p))
    })?;
    let response = request(
        &live,
        "POST",
        &p.path("/recover"),
        Some(&json!({"deviceId":p.device_id,"generation":p.generation,"confirmed":true})),
    )?;
    p.epoch = text(&response, "epoch")?.into();
    bound_grant(&p, &response["grant"])?;
    let ids = access(shared, token, |s, t| {
        let mut q=s.connection.prepare("SELECT command,state,server_cursor FROM outbox WHERE tenant=? AND company=? AND local_only=0 ORDER BY sequence")?;
        let found = q
            .query_map(params![t, company], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(found)
    })?;
    let mut outcomes = Vec::new();
    for chunk in ids.chunks(100) {
        let result = request(
            &live,
            "POST",
            &p.path("/receipts"),
            Some(&json!({"ids":chunk.iter().map(|r|&r.0).collect::<Vec<_>>()})),
        )?;
        let found = result.as_array().ok_or_else(|| {
            error(
                "INVALID_SERVICE_RESPONSE",
                "Expected receipt reconciliation results.",
            )
        })?;
        for (id, state, known) in chunk {
            if state == "accepted"
                && known.is_some()
                && !found
                    .iter()
                    .any(|r| r["commandId"] == *id && r["status"] == "accepted")
            {
                return Err(error("CANONICAL_HISTORY_CONFLICT","Server recovery is missing a previously accepted receipt. No local history was discarded."));
            }
        }
        outcomes.extend(found.iter().cloned());
    }
    access(shared, token, |s, t| {
        let current = get_profile(s, t, company)?;
        connected(s, Some(&current))?;
        if generation(s)? != p.generation {
            return Err(error("RESTORED_DEVICE", "Vault changed during recovery."));
        }
        sync_store::apply_snapshot(
            s,
            &current,
            sync_store::Snapshot {
                book: &response["book"],
                after: current.cursor,
                cursor: number(&response, "cursor")?,
                epoch: &p.epoch,
                outcomes: &outcomes,
                recovery: true,
            },
        )?;
        let tx = s.connection.transaction()?;
        tx.execute("UPDATE sync_profiles SET generation=?,epoch=?,offline_grant=?,paused=NULL,lease_owner=NULL,lease_until=0 WHERE tenant=? AND company=?",params![p.generation,p.epoch,response["grant"].to_string(),t,company])?;
        tx.execute("UPDATE outbox SET state='pending',lease_owner=NULL,lease_until=0,next_attempt=0 WHERE tenant=? AND company=? AND state='sending'",params![t,company])?;
        tx.commit()?;
        Ok(())
    })?;
    status(shared, token, company)
}
