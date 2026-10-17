// shared by both integration test binaries; not every one uses every helper
#![allow(dead_code)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use rbox::{db, router, state::AppState, users};
use std::path::{Path, PathBuf};
use tower::ServiceExt;

pub struct Ctx {
    pub dir: tempfile::TempDir,
    pub app: axum::Router,
    pub cookie: String,
}

pub async fn setup(username: &str, quota: u64, admin: bool) -> Ctx {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(dir.path()).unwrap();
    db::init_schema(&conn).unwrap();
    let id = users::create(&conn, username, "password123", quota, admin).unwrap();
    std::fs::create_dir_all(db::user_dir(dir.path(), id)).unwrap();
    drop(conn);

    let app = router::build(AppState::new(dir.path()).unwrap());
    let cookie = login(&app, username, "password123").await;
    Ctx { dir, app, cookie }
}

pub async fn login(app: &axum::Router, username: &str, password: &str) -> String {
    let body = serde_json::json!({ "username": username, "password": password });
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "login should succeed");
    res.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

pub fn get(ctx: &Ctx, uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", &ctx.cookie)
        .body(Body::empty())
        .unwrap()
}

pub fn req(ctx: &Ctx, method: &str, uri: &str, body: impl Into<Body>) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", &ctx.cookie)
        .header("content-type", "application/json")
        .body(body.into())
        .unwrap()
}

pub async fn send(ctx: &Ctx, req: Request<Body>) -> (StatusCode, Vec<u8>, Option<String>) {
    let res = ctx.app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let ctype = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, bytes.to_vec(), ctype)
}

pub fn multipart(files: &[(&str, &str)]) -> (String, Vec<u8>) {
    let boundary = "rboxtestboundary";
    let mut body = Vec::new();
    for (name, data) in files {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"{name}\"\r\ncontent-type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(data.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

pub async fn upload(
    ctx: &Ctx,
    dir_param: &str,
    files: &[(&str, &str)],
) -> (StatusCode, Vec<u8>, Option<String>) {
    let (ctype, body) = multipart(files);
    let mut r = req(
        ctx,
        "POST",
        &format!("/api/files/upload?path={dir_param}"),
        Body::from(body),
    );
    r.headers_mut()
        .insert("content-type", ctype.parse().unwrap());
    send(ctx, r).await
}

pub fn user_dir(ctx: &Ctx) -> PathBuf {
    let mut entries = std::fs::read_dir(ctx.dir.path().join("users")).unwrap();
    entries.next().unwrap().unwrap().path()
}

pub async fn used_bytes(dir: &Path) -> i64 {
    let conn = rusqlite::Connection::open(db::db_path(dir)).unwrap();
    conn.query_row("SELECT used_bytes FROM users", [], |r| r.get(0))
        .unwrap()
}

pub fn exec_sql(dir: &Path, sql: &str) {
    let conn = rusqlite::Connection::open(db::db_path(dir)).unwrap();
    conn.execute_batch(sql).unwrap();
}

pub fn set_used(ctx: &Ctx, used: u64) {
    exec_sql(
        ctx.dir.path(),
        &format!("UPDATE users SET used_bytes = {used}"),
    );
}

pub async fn send_full(
    ctx: &Ctx,
    req: Request<Body>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let res = ctx.app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, headers, bytes.to_vec())
}
