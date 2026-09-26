//! Network access for the digital-signature tools.
//!
//! Timestamp authorities and certificate issuers rarely send CORS headers, so
//! the webview cannot call them directly. This command makes the request on
//! its behalf, but only to public internet hosts: the name is resolved first,
//! every address is checked, and the connection is pinned to a checked address
//! so DNS rebinding cannot redirect it to the local network afterwards.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use base64::Engine;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use url::Url;

const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetResponse {
    status: u16,
    content_type: String,
    /// Base64: responses are small (certificates, timestamp tokens).
    body: String,
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    let raw = request.headers().get(name)?.to_str().ok()?;
    Some(percent_decode_str(raw).decode_utf8_lossy().into_owned())
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b)) // carrier-grade NAT
        || (a == 198 && (b == 18 || b == 19)) // benchmarking
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00 // unique local
        || (first & 0xffc0) == 0xfe80 // link local
        || first == 0x2001 && ip.segments()[1] == 0x0db8) // documentation
}

pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

async fn resolve_public(url: &Url) -> Result<SocketAddr, String> {
    let host = url.host_str().ok_or("URL has no host")?;
    let port = url.port_or_known_default().ok_or("URL has no port")?;
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("Could not resolve {host}: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("Could not resolve {host}"));
    }
    // Refuse outright if any answer is private: a mixed answer is a red flag.
    if let Some(bad) = addrs.iter().find(|a| !is_public(a.ip())) {
        return Err(format!("{host} resolves to a non-public address ({})", bad.ip()));
    }
    Ok(addrs[0])
}

#[tauri::command]
pub async fn net_fetch(request: Request<'_>) -> Result<NetResponse, String> {
    let url = header(&request, "x-url").ok_or("missing x-url header")?;
    let url = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https URLs are allowed".into());
    }
    let method = match header(&request, "x-method").as_deref() {
        Some("POST") => reqwest::Method::POST,
        Some("GET") | None => reqwest::Method::GET,
        Some(other) => return Err(format!("Method {other} is not allowed")),
    };
    let body = match request.body() {
        InvokeBody::Raw(bytes) if method == reqwest::Method::POST => bytes.clone(),
        _ => Vec::new(),
    };

    let addr = resolve_public(&url).await?;
    let host = url.host_str().unwrap_or_default().to_owned();
    let client = reqwest::Client::builder()
        .resolve(&host, addr)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .user_agent(concat!("UnAcrobat/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, url);
    if let Some(ct) = header(&request, "x-content-type") {
        req = req.header(reqwest::header::CONTENT_TYPE, ct);
    }
    let mut res = req.body(body).send().await.map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mut buf = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("Response too large".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(NetResponse {
        status,
        content_type,
        body: base64::engine::general_purpose::STANDARD.encode(buf),
    })
}

#[cfg(test)]
mod tests {
    use super::is_public;

    #[test]
    fn rejects_local_and_private_addresses() {
        for ip in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip} should be blocked");
        }
    }

    #[test]
    fn allows_public_addresses() {
        for ip in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip} should be allowed");
        }
    }
}
