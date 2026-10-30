use crate::{error, Result};
use reqwest::{blocking::Client, Method, Url};
use serde_json::Value;
use std::{io::Read, time::Duration};

pub const RESPONSE_LIMIT: u64 = 18 * 1024 * 1024;
pub fn endpoint(raw: &str) -> Result<String> {
    let url = Url::parse(raw)
        .map_err(|_| error("INVALID_ENDPOINT", "Enter the service's HTTPS origin."))?;
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host == "::1"
            || host == "[::1]"
            || host
                .parse::<std::net::Ipv4Addr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(error("INVALID_ENDPOINT","Use an HTTPS origin without credentials, query or path. HTTP is allowed only on loopback."));
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
pub fn request(
    base: &str,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Value> {
    let origin = endpoint(base)?;
    if !path.starts_with("/v1/") && path != "/health" {
        return Err(error("UNSUPPORTED_OPERATION", "Unsupported service route."));
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| error("NETWORK_UNAVAILABLE", "Secure transport could not start."))?;
    let verb = Method::from_bytes(method.as_bytes())
        .map_err(|_| error("UNSUPPORTED_OPERATION", "Unsupported service method."))?;
    let mut builder = client.request(verb, origin + path);
    if let Some(secret) = token {
        builder = builder.bearer_auth(secret);
    }
    if let Some(value) = body {
        if value.to_string().len() > 16 * 1024 * 1024 {
            return Err(error(
                "DATA_LIMIT",
                "Sync request exceeds this version's supported size.",
            ));
        }
        builder = builder.json(value);
    }
    let response=builder.send().map_err(|_|error("NETWORK_UNAVAILABLE","Service response is unknown. Local records are safe; retry uses the original command ID."))?;
    let status = response.status();
    if status.is_redirection() {
        return Err(error(
            "UNTRUSTED_REDIRECT",
            "Service redirects are blocked. Review the configured origin.",
        ));
    }
    let retry = response
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|n| n.clamp(1, 300));
    let mut bytes = Vec::new();
    response.take(RESPONSE_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > RESPONSE_LIMIT {
        return Err(error(
            "DATA_LIMIT",
            "Service response exceeds the supported size. Local work is retained.",
        ));
    }
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            "INVALID_SERVICE_RESPONSE",
            "Service returned an invalid response; no cloud outcome was inferred.",
        )
    })?;
    if !status.is_success() {
        let row = &data["error"];
        let code = row["code"]
            .as_str()
            .filter(|s| s.len() <= 100)
            .unwrap_or("SERVER_ERROR");
        let message = row["message"]
            .as_str()
            .filter(|s| s.len() <= 2000)
            .unwrap_or("Service operation failed; original work is retained.");
        let mut failure = error(code, message);
        failure.retry_after = retry;
        failure.field = row["field"]
            .as_str()
            .filter(|s| {
                s.len() <= 100
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.')
            })
            .map(str::to_owned);
        return Err(failure);
    }
    Ok(data)
}
