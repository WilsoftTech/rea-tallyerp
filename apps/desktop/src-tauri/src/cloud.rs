use crate::{error, grants, storage::Store, validation::text, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use zeroize::Zeroizing;

#[derive(Clone)]
pub struct CloudSession {
    pub endpoint: String,
    pub token: Zeroizing<String>,
    pub user_id: String,
    pub tenants: Value,
}
#[derive(Clone)]
pub struct Profile {
    pub tenant: String,
    pub company: String,
    pub endpoint: String,
    pub remote_tenant: String,
    pub remote_company: String,
    pub user_id: String,
    pub device_id: String,
    pub generation: String,
    pub epoch: String,
    pub public_key: String,
    pub grant: Value,
    pub cursor: i64,
    pub canonical: Value,
    pub paused: Option<String>,
    pub last_seen: u64,
}
impl Profile {
    pub fn path(&self, suffix: &str) -> String {
        format!(
            "/v1/tenants/{}/companies/{}{}",
            self.remote_tenant, self.remote_company, suffix
        )
    }
}
pub fn profile(store: &Store, tenant: &str, company: &str) -> Result<Option<Profile>> {
    let row=store.connection.query_row("SELECT endpoint,remote_tenant,remote_company,user_id,device_id,generation,epoch,public_key,offline_grant,cursor,canonical,paused,last_seen FROM sync_profiles WHERE tenant=? AND company=?",
        params![tenant,company],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?,r.get::<_,i64>(9)?,r.get::<_,String>(10)?,r.get::<_,Option<String>>(11)?,r.get::<_,i64>(12)?))).optional()?;
    let Some((
        endpoint,
        remote_tenant,
        remote_company,
        user_id,
        device_id,
        generation,
        epoch,
        public_key,
        signed,
        cursor,
        canonical,
        paused,
        last_seen,
    )) = row
    else {
        return Ok(None);
    };
    Ok(Some(Profile {
        tenant: tenant.into(),
        company: company.into(),
        endpoint,
        remote_tenant,
        remote_company,
        user_id,
        device_id,
        generation,
        epoch,
        public_key,
        grant: serde_json::from_str(&signed)?,
        cursor,
        canonical: serde_json::from_str(&canonical)?,
        paused,
        last_seen: u64::try_from(last_seen)
            .map_err(|_| error("CLOCK_INVALID", "Stored clock observation is invalid."))?,
    }))
}
pub fn permissions(store: &Store, p: &Profile) -> Result<grants::Claims> {
    if p.paused.as_deref().is_some_and(|reason| {
        [
            "restored",
            "access-revoked",
            "device-revoked",
            "recovery-required",
            "signed-out",
            "history-conflict",
        ]
        .contains(&reason)
    }) {
        return Err(error("SYNC_REVIEW_REQUIRED","This synchronized company requires online authority or recovery review. Read and backup remain available."));
    }
    let current: String =
        store
            .connection
            .query_row("SELECT generation FROM vault WHERE singleton=1", [], |r| {
                r.get(0)
            })?;
    let wall = grants::now()?;
    let elapsed = store
        .offline_clock
        .1
        .saturating_add(store.offline_clock.0.elapsed().as_secs());
    if wall.saturating_add(300) < elapsed {
        return Err(error(
            "CLOCK_ROLLBACK",
            "Correct the device clock and reconnect before posting.",
        ));
    }
    let claims = grants::verify(&p.grant, &p.public_key, wall.max(elapsed), p.last_seen)?;
    if claims.tenant_id != p.remote_tenant
        || claims.company_id != p.remote_company
        || claims.source_tenant != p.tenant
        || claims.source_company != p.company
        || claims.user_id != p.user_id
        || claims.device_id != p.device_id
        || claims.epoch != p.epoch
        || claims.generation != current
        || claims.generation != p.generation
    {
        return Err(error("RESTORED_DEVICE","Offline authority differs from this vault/device. Sign in and reconcile recovery before posting."));
    }
    Ok(claims)
}
pub fn require_write(store: &Store, tenant: &str, company: &str, after: &Value) -> Result<()> {
    let Some(p) = profile(store, tenant, company)? else {
        let enrolling:bool=store.connection.query_row("SELECT EXISTS(SELECT 1 FROM enrollment_intents WHERE tenant=? AND company=? AND state='pending')",params![tenant,company],|r|r.get(0))?;
        if enrolling {
            let action = after["audit"]
                .as_array()
                .and_then(|a| a.last())
                .and_then(|a| a["action"].as_str())
                .unwrap_or("");
            if !["post", "post-draft", "reverse", "save-draft"].contains(&action) {
                return Err(error("ENROLLMENT_PENDING","Shared master edits wait until enrollment is reconciled; device posting and backup remain available."));
            }
        }
        return Ok(());
    };
    let claims = permissions(store, &p)?;
    let action = after["audit"]
        .as_array()
        .and_then(|a| a.last())
        .and_then(|a| a["action"].as_str())
        .unwrap_or("");
    let required = match action {
        "post" | "post-draft" => "post",
        "reverse" => "reverse",
        "save-draft" => "draft",
        _ => {
            return Err(error(
                "ONLINE_MASTER_REQUIRED",
                "Connect to the service to edit shared masters or period locks.",
            ))
        }
    };
    if !claims.permissions.iter().any(|p| p == required) {
        return Err(error(
            "FORBIDDEN",
            "Current offline permissions do not authorize this operation.",
        ));
    }
    let receipt = after["receipts"]
        .as_array()
        .and_then(|a| a.last())
        .ok_or_else(|| error("INCOMPLETE_POSTING", "A typed receipt is required."))?;
    if receipt["command"].is_null()
        || text(&receipt["command"], "commandId")? != text(receipt, "commandId")?
    {
        return Err(error(
            "WIRE_COMMAND_REQUIRED",
            "This client cannot safely synchronize the financial command. Upgrade before posting.",
        ));
    }
    check_wire(after, receipt)?;
    Ok(())
}
fn input_matches(input: &Value, entry: &Value, draft: bool) -> bool {
    let keys = if draft {
        vec![
            "tenantId",
            "companyId",
            "id",
            "date",
            "periodId",
            "expectedPeriodVersion",
            "intent",
            "narration",
        ]
    } else {
        vec![
            "tenantId",
            "companyId",
            "id",
            "date",
            "periodId",
            "intent",
            "narration",
        ]
    };
    keys.iter().all(|key| input[*key] == entry[*key])
        && input["lines"]
            .as_array()
            .zip(entry["lines"].as_array())
            .is_some_and(|(a, b)| {
                a.len() == b.len()
                    && a.iter().zip(b).all(|(a, b)| {
                        ["ledgerId", "side", "amount"]
                            .iter()
                            .all(|key| a[*key] == b[*key])
                    })
            })
}
fn check_wire(after: &Value, receipt: &Value) -> Result<()> {
    let command = &receipt["command"];
    let result = &receipt["result"];
    let action = after["audit"]
        .as_array()
        .and_then(|rows| rows.last())
        .map(|event| &event["action"]);
    if action != Some(&command["kind"]) || command["expectedChartVersion"] != after["chartVersion"]
    {
        return Err(error(
            "WIRE_MISMATCH",
            "Outbox command does not match the committed action/chart revision.",
        ));
    }
    let matches=match command["kind"].as_str() {
        Some("post")=> input_matches(&command["journal"],result,false) && command["journal"]["expectedPeriodVersion"]==result["periodVersion"],
        Some("reverse")=> command["originalId"]==result["reverses"] &&
            ["tenantId","companyId","id","date","periodId","narration"].iter().all(|key|command["journal"][*key]==result[*key]) &&
            command["journal"]["expectedPeriodVersion"]==result["periodVersion"],
        Some("save-draft")=> input_matches(&command["draft"],result,true) && after["drafts"].as_array().is_some_and(|drafts|drafts.contains(result)),
        Some("post-draft")=> command["entryId"]==result["id"] && command["expectedPeriodVersion"]==result["periodVersion"] &&
            after["drafts"].as_array().is_some_and(|drafts|drafts.iter().any(|d|d["id"]==command["draftId"] &&
                d["status"]=="posted" && input_matches(d,&serde_json::json!({
                    "tenantId":result["tenantId"],"companyId":result["companyId"],"id":d["id"],"date":result["date"],
                    "periodId":result["periodId"],"intent":result["intent"],"narration":result["narration"],"lines":result["lines"]
                }),false))),
        _=>false,
    };
    if !matches {
        return Err(error(
            "WIRE_MISMATCH",
            "Outbox financial values must exactly match the immutable local result.",
        ));
    }
    Ok(())
}
