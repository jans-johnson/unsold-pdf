//! Where the webview loads the app from.
//!
//! The Office converters and some image tools use WebAssembly threads, which
//! need a cross-origin-isolated page. WebKit (macOS, iOS, Linux) only grants
//! that to http(s) origins, never to custom schemes like `tauri://`, so on
//! those platforms the embedded assets are served from a loopback HTTP server
//! owned by this process. Windows and Android already use an
//! `http://tauri.localhost` origin that Chromium isolates.
//!
//! The server is bound before the window exists, so the window can never load
//! a server some other process put on the port. It only serves the bundled
//! assets (no APIs), only answers GET/HEAD, and rejects foreign Host headers
//! so DNS-rebinding pages can't read through it.

use tauri::{AppHandle, Runtime, WebviewUrl};

/// Security headers sent with every asset (mirrors tauri.conf.json).
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux"))]
pub const HEADERS: &[(&str, &str)] = &[
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Embedder-Policy", "require-corp"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("X-Content-Type-Options", "nosniff"),
];

pub const START_PAGE: &str = "studio/index.html";

/// Fixed so local storage (preferences) survives restarts; any free port is
/// used if it's taken.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux"))]
const PREFERRED_PORT: u16 = 47_862;

/// The URL the main window should open.
pub fn start_url<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewUrl> {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux"))]
    if !tauri::is_dev() {
        let origin = loopback::serve(app)?;
        return Ok(WebviewUrl::External(origin.join(START_PAGE).expect("valid start page")));
    }
    let _ = app;
    Ok(WebviewUrl::App(START_PAGE.into()))
}

/// Whether the webview may navigate to `url`; anything else opens externally.
pub fn is_app_url(url: &url::Url, app_origin: &url::Origin) -> bool {
    matches!(url.scheme(), "about" | "blob" | "data" | "tauri") || &url.origin() == app_origin
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux"))]
mod loopback {
    use super::{HEADERS, PREFERRED_PORT};
    use percent_encoding::percent_decode_str;
    use std::net::{Ipv4Addr, SocketAddr};
    use tauri::{AppHandle, Runtime};
    use tiny_http::{Header, Method, Request, Response, Server};

    pub fn serve<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<url::Url> {
        let server = [PREFERRED_PORT, 0]
            .into_iter()
            .find_map(|port| Server::http(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).ok())
            .ok_or_else(|| std::io::Error::other("could not bind a loopback port"))?;
        let port = server
            .server_addr()
            .to_ip()
            .map(|a| a.port())
            .ok_or_else(|| std::io::Error::other("loopback server has no port"))?;
        let host = format!("127.0.0.1:{port}");
        let resolver = app.asset_resolver();

        std::thread::Builder::new()
            .name("app-origin".into())
            .spawn(move || {
                for request in server.incoming_requests() {
                    let response = respond(&resolver, &request, &host);
                    let _ = request.respond(response);
                }
            })?;
        Ok(url::Url::parse(&format!("http://127.0.0.1:{port}/")).expect("valid loopback URL"))
    }

    fn respond<R: Runtime>(
        resolver: &tauri::AssetResolver<R>,
        request: &Request,
        host: &str,
    ) -> Response<std::io::Cursor<Vec<u8>>> {
        let host_ok = request
            .headers()
            .iter()
            .any(|h| h.field.equiv("Host") && h.value.as_str() == host);
        if !host_ok {
            return text(421, "Misdirected request");
        }
        if !matches!(request.method(), Method::Get | Method::Head) {
            return text(405, "Method not allowed");
        }
        let path = request.url().split(['?', '#']).next().unwrap_or("/");
        let path = percent_decode_str(path).decode_utf8_lossy();
        let Some(asset) = resolver.get(path.into_owned()) else {
            return text(404, "Not found");
        };
        let mut response = Response::from_data(asset.bytes).with_status_code(200);
        response.add_header(header("Content-Type", &asset.mime_type));
        response.add_header(header("Cache-Control", "no-cache"));
        if let Some(csp) = asset.csp_header {
            response.add_header(header("Content-Security-Policy", &csp));
        }
        for (name, value) in HEADERS {
            response.add_header(header(name, value));
        }
        response
    }

    fn header(name: &str, value: &str) -> Header {
        Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
    }

    fn text(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
        Response::from_string(body).with_status_code(status)
    }
}

#[cfg(test)]
mod tests {
    use super::is_app_url;

    #[test]
    fn only_the_app_origin_stays_in_the_webview() {
        let origin = url::Url::parse("http://127.0.0.1:47862/studio/").unwrap().origin();
        let ok = ["http://127.0.0.1:47862/merge-pdf", "blob:http://127.0.0.1:47862/x", "about:blank"];
        let external = ["http://127.0.0.1:8080/", "https://example.com/", "http://localhost:47862/"];
        for u in ok {
            assert!(is_app_url(&url::Url::parse(u).unwrap(), &origin), "{u}");
        }
        for u in external {
            assert!(!is_app_url(&url::Url::parse(u).unwrap(), &origin), "{u}");
        }
    }
}
