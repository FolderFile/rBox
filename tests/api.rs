use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use rbox::{db, router, state::AppState, users};
use std::path::{Path, PathBuf};
use tower::ServiceExt;

struct Ctx {
    dir: tempfile::TempDir,
    app: axum::Router,
    cookie: String,
}

async fn setup(username: &str, quota: u64) -> Ctx {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(dir.path()).unwrap();
    db::init_schema(&conn).unwrap();
    let id = users::create(&conn, username, "password123", quota, false).unwrap();
    std::fs::create_dir_all(db::user_dir(dir.path(), id)).unwrap();
    drop(conn);

    let app = router::build(AppState::new(dir.path()).unwrap());
    let cookie = login(&app, username, "password123").await;
    Ctx { dir, app, cookie }
}

async fn login(app: &axum::Router, username: &str, password: &str) -> String {
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

fn get(ctx: &Ctx, uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", &ctx.cookie)
        .body(Body::empty())
        .unwrap()
}

fn req(ctx: &Ctx, method: &str, uri: &str, body: impl Into<Body>) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", &ctx.cookie)
        .header("content-type", "application/json")
        .body(body.into())
        .unwrap()
}

async fn send(ctx: &Ctx, req: Request<Body>) -> (StatusCode, Vec<u8>, Option<String>) {
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

fn multipart(files: &[(&str, &str)]) -> (String, Vec<u8>) {
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

async fn upload(
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

fn user_dir(ctx: &Ctx) -> PathBuf {
    let mut entries = std::fs::read_dir(ctx.dir.path().join("users")).unwrap();
    entries.next().unwrap().unwrap().path()
}

async fn used_bytes(dir: &Path) -> i64 {
    let conn = rusqlite::Connection::open(db::db_path(dir)).unwrap();
    conn.query_row("SELECT used_bytes FROM users", [], |r| r.get(0))
        .unwrap()
}

fn set_used(ctx: &Ctx, used: u64) {
    let conn = rusqlite::Connection::open(db::db_path(ctx.dir.path())).unwrap();
    conn.execute("UPDATE users SET used_bytes = ?1", [used as i64])
        .unwrap();
}

#[tokio::test]
async fn login_rejects_bad_password_and_sets_cookie_flags() {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(dir.path()).unwrap();
    db::init_schema(&conn).unwrap();
    let id = users::create(&conn, "u", "password123", 1000, false).unwrap();
    std::fs::create_dir_all(db::user_dir(dir.path(), id)).unwrap();
    drop(conn);
    let app = router::build(AppState::new(dir.path()).unwrap());

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"username":"u","password":"wrong"}"#.to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"username":"u","password":"password123"}"#.to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let set_cookie = res.headers()["set-cookie"].to_str().unwrap();
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Lax"));
}

#[tokio::test]
async fn unauthenticated_requests_get_401() {
    let ctx = setup("u1", 1024).await;
    let res = ctx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/files?path=")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn listing_sorts_dirs_first_and_rejects_traversal() {
    let ctx = setup("u1", 1024).await;
    let root = user_dir(&ctx);
    std::fs::create_dir_all(root.join("zdir")).unwrap();
    std::fs::write(root.join("afile.txt"), "hi").unwrap();

    let (status, body, _) = send(&ctx, get(&ctx, "/api/files?path=")).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let names: Vec<&str> = v["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["zdir", "afile.txt"]);

    for bad in [
        "/api/files?path=..",
        "/api/files?path=a/../..",
        "/api/files?path=/etc/passwd",
    ] {
        let (status, _, _) = send(&ctx, get(&ctx, bad)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
}

#[tokio::test]
async fn upload_within_quota_then_abort_on_overflow() {
    let ctx = setup("u1", 64).await;
    let root = user_dir(&ctx);

    let (status, _, _) = upload(&ctx, "", &[("small.txt", "hello world")]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read(root.join("small.txt")).unwrap(),
        b"hello world"
    );
    assert_eq!(used_bytes(ctx.dir.path()).await, 11);

    let big = "x".repeat(100);
    let (status, resp, _) = upload(&ctx, "", &[("big.bin", &big)]).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    let e: serde_json::Value = serde_json::from_slice(&resp).unwrap();
    assert!(e["error"].as_str().unwrap().contains("quota exceeded"));
    assert!(
        !root.join("big.bin").exists(),
        "partial upload must be removed"
    );
    for entry in std::fs::read_dir(&root).unwrap() {
        let name = entry.unwrap().file_name();
        assert!(
            !name.to_string_lossy().starts_with(".rbox-tmp"),
            "stray staging file"
        );
    }
    assert_eq!(used_bytes(ctx.dir.path()).await, 11, "db must be unchanged");
}

#[tokio::test]
async fn overwrite_upload_refills_budget() {
    let ctx = setup("u1", 32).await;
    let root = user_dir(&ctx);

    let (status, _, _) = upload(&ctx, "", &[("a.txt", "0123456789")]).await;
    assert_eq!(status, StatusCode::OK);
    // replacing the 10-byte file with 12 bytes still fits the 32-byte quota
    let (status, _, _) = upload(&ctx, "", &[("a.txt", "0123456789ab")]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), b"0123456789ab");
    assert_eq!(used_bytes(ctx.dir.path()).await, 12);

    // but a 40-byte replacement doesn't
    let big = "y".repeat(40);
    let (status, _, _) = upload(&ctx, "", &[("a.txt", &big)]).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), b"0123456789ab");
}

#[tokio::test]
async fn range_downloads() {
    let ctx = setup("u1", 1024).await;
    let root = user_dir(&ctx);
    let data = "abcdefghijklmnopqrstuvwxyz".repeat(10); // 260 bytes
    std::fs::write(root.join("media.bin"), &data).unwrap();
    set_used(&ctx, 260);

    let (status, body, _) = send(&ctx, get(&ctx, "/api/files/download?path=media.bin")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.len(), 260);

    let mut r = get(&ctx, "/api/files/download?path=media.bin");
    r.headers_mut()
        .insert("range", "bytes=0-9".parse().unwrap());
    let (status, body, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, b"abcdefghij");

    let mut r = get(&ctx, "/api/files/download?path=media.bin");
    r.headers_mut()
        .insert("range", "bytes=250-".parse().unwrap());
    let (status, body, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &data.as_bytes()[250..]);

    let mut r = get(&ctx, "/api/files/download?path=media.bin");
    r.headers_mut()
        .insert("range", "bytes=-10".parse().unwrap());
    let (status, body, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &data.as_bytes()[250..]);

    let mut r = get(&ctx, "/api/files/download?path=media.bin");
    r.headers_mut()
        .insert("range", "bytes=999-".parse().unwrap());
    let (status, _, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn zip_streams_directory() {
    let ctx = setup("u1", 1024).await;
    let root = user_dir(&ctx);
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("sub/inner.txt"), "inner").unwrap();
    std::fs::write(root.join("top.txt"), "top").unwrap();

    let (status, body, ctype) = send(&ctx, get(&ctx, "/api/files/zip?path=")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ctype.as_deref(), Some("application/zip"));
    assert!(body.starts_with(b"PK"));

    let archive = zip::ZipArchive::new(std::io::Cursor::new(body)).unwrap();
    let names: Vec<String> = archive
        .file_names()
        .filter_map(|n| n.ok().map(|c| c.to_string()))
        .collect();
    assert!(names.contains(&"sub/".to_string()));
    assert!(names.contains(&"sub/inner.txt".to_string()));
    assert!(names.contains(&"top.txt".to_string()));
}

#[tokio::test]
async fn text_content_roundtrip_and_quota() {
    let ctx = setup("u1", 32).await;
    let root = user_dir(&ctx);

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "PUT",
            "/api/files/content?path=notes.txt",
            Body::from("hello"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(std::fs::read(root.join("notes.txt")).unwrap(), b"hello");
    assert_eq!(used_bytes(ctx.dir.path()).await, 5);

    let (status, body, _) = send(&ctx, get(&ctx, "/api/files/content?path=notes.txt")).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["content"], "hello");

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "PUT",
            "/api/files/content?path=notes.txt",
            Body::from("y".repeat(40)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(std::fs::read(root.join("notes.txt")).unwrap(), b"hello");
    assert_eq!(used_bytes(ctx.dir.path()).await, 5);
}

#[tokio::test]
async fn mkdir_copy_delete_track_usage() {
    let ctx = setup("u1", 1024).await;

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/mkdir",
            Body::from(r#"{"path":"docs"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = upload(&ctx, "docs", &[("a.txt", "12345")]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(used_bytes(ctx.dir.path()).await, 5);

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/copy",
            Body::from(r#"{"path":"docs/a.txt","dest_dir":""}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(used_bytes(ctx.dir.path()).await, 10);

    let (status, resp, _) = send(
        &ctx,
        req(&ctx, "DELETE", "/api/files?path=a.txt", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&resp).unwrap();
    assert_eq!(v["bytes_freed"], 5);
    assert_eq!(used_bytes(ctx.dir.path()).await, 5);
}

#[tokio::test]
async fn copy_that_would_exceed_quota_is_rejected() {
    let ctx = setup("u2", 8).await;
    let root = user_dir(&ctx);

    let (status, _, _) = upload(&ctx, "", &[("a.txt", "12345678")]).await;
    assert_eq!(status, StatusCode::OK);

    std::fs::create_dir_all(root.join("dest")).unwrap();
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/copy",
            Body::from(r#"{"path":"a.txt","dest_dir":"dest"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(!root.join("dest/a.txt").exists());
}

#[tokio::test]
async fn rename_and_move_stay_in_sandbox() {
    let ctx = setup("u1", 1024).await;
    let root = user_dir(&ctx);
    std::fs::create_dir_all(root.join("d1")).unwrap();
    std::fs::write(root.join("d1/a.txt"), "x").unwrap();

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/rename",
            Body::from(r#"{"path":"d1/a.txt","new_name":"b.txt"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(root.join("d1/b.txt").exists());

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/move",
            Body::from(r#"{"path":"d1/b.txt","dest_dir":""}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(root.join("b.txt").exists());

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/rename",
            Body::from(r#"{"path":"b.txt","new_name":"../escape.txt"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!ctx.dir.path().join("users").join("escape.txt").exists());
}
