use crate::{error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claims {
    pub protocol: u8,
    pub tenant_id: String,
    pub company_id: String,
    pub user_id: String,
    pub device_id: String,
    pub generation: String,
    pub source_tenant: String,
    pub source_company: String,
    pub epoch: String,
    pub permissions: Vec<String>,
    pub issued_at: u64,
    pub expires_at: u64,
    pub role_version: u64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Signed {
    pub payload: String,
    pub signature: String,
    pub public_key: String,
}
pub fn now() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| error("CLOCK_INVALID", "Correct the device clock before posting."))
}
pub fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 100
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    {
        return Err(error("INVALID_ID", "Use a nonempty bounded identifier."));
    }
    Ok(())
}
pub fn verify(signed: &Value, pin: &str, now: u64, last_seen: u64) -> Result<Claims> {
    let envelope: Signed = serde_json::from_value(signed.clone())?;
    if envelope.public_key != pin || envelope.payload.len() > 8192 {
        return Err(error(
            "UNTRUSTED_GRANT",
            "Offline authority does not match the pinned service key.",
        ));
    }
    let public = URL_SAFE_NO_PAD
        .decode(&envelope.public_key)
        .map_err(|_| error("UNTRUSTED_GRANT", "Invalid service key."))?;
    let key: [u8; 32] = public
        .try_into()
        .map_err(|_| error("UNTRUSTED_GRANT", "Invalid service key."))?;
    let body = URL_SAFE_NO_PAD
        .decode(&envelope.payload)
        .map_err(|_| error("UNTRUSTED_GRANT", "Invalid offline grant."))?;
    let signature = URL_SAFE_NO_PAD
        .decode(&envelope.signature)
        .map_err(|_| error("UNTRUSTED_GRANT", "Invalid offline signature."))?;
    let signature = Signature::try_from(signature.as_slice())
        .map_err(|_| error("UNTRUSTED_GRANT", "Invalid offline signature."))?;
    VerifyingKey::from_bytes(&key)
        .map_err(|_| error("UNTRUSTED_GRANT", "Invalid service key."))?
        .verify_strict(&body, &signature)
        .map_err(|_| error("UNTRUSTED_GRANT", "Offline grant signature did not verify."))?;
    let claims: Claims = serde_json::from_slice(&body)?;
    for id in [
        &claims.tenant_id,
        &claims.company_id,
        &claims.user_id,
        &claims.device_id,
        &claims.generation,
        &claims.source_tenant,
        &claims.source_company,
        &claims.epoch,
    ] {
        identifier(id)?;
    }
    let allowed = [
        "read",
        "post",
        "reverse",
        "draft",
        "manage-chart",
        "manage-periods",
        "reopen-period",
    ];
    let unique: HashSet<_> = claims.permissions.iter().collect();
    if claims.protocol != 1
        || claims.role_version == 0
        || unique.len() != claims.permissions.len()
        || claims.permissions.len() > 7
        || claims
            .permissions
            .iter()
            .any(|p| !allowed.contains(&p.as_str()))
        || !claims
            .expires_at
            .checked_sub(claims.issued_at)
            .is_some_and(|duration| duration > 0 && duration <= 86400)
    {
        return Err(error(
            "UNTRUSTED_GRANT",
            "Offline authority has unsupported permissions or duration.",
        ));
    }
    if now.saturating_add(300) < last_seen || claims.issued_at > now.saturating_add(300) {
        return Err(error(
            "CLOCK_ROLLBACK",
            "Correct the device clock and reconnect before posting.",
        ));
    }
    if now >= claims.expires_at {
        return Err(error("OFFLINE_GRANT_EXPIRED","Offline posting permission expired. Read and backup remain available; reconnect to renew."));
    }
    Ok(claims)
}
