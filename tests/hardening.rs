//! regression tests for the 0.5 hardening pass: quota accounting that can't be
//! dodged, root-escaping file ops, share bookkeeping, and abuse limits
mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::*;
use rbox::{router, state::AppState};
use tower::ServiceExt;

async fn json(ctx: &Ctx, method: &str, uri: &str, body: &str) -> (StatusCode, serde_json::Value) {
    let (status, bytes, _) = send(ctx, req(ctx, method, uri, Body::from(body.to_string()))).await;
    let v = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, v)
}

/// the invariant every write path must keep: the db figure equals what's on
/// disk, staging files included (they're real bytes on the user's volume)
async fn assert_accounting_consistent(ctx: &Ctx) {
    let on_disk = rbox::storage::disk_usage(&user_dir(ctx));
    assert_eq!(
        used_bytes(ctx.dir.path()).await,
        on_disk as i64,
        "used_bytes drifted from disk usage"
    );
}

fn staging_leftovers(ctx: &Ctx) -> Vec<String> {
    std::fs::read_dir(user_dir(ctx))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(".rbox-tmp"))
        .collect()
}

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut buf);
        for (name, data) in entries {
            zw.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zw.write_all(data).unwrap();
        }
        zw.finish().unwrap();
    }
    buf.into_inner()
}

#[tokio::test]
async fn uploads_larger_than_two_megabytes_are_accepted() {
    let ctx = setup("u1", 64 * 1024 * 1024, false).await;
    let big = "x".repeat(3 * 1024 * 1024);
    let (status, body, _) = upload(&ctx, "", &[("big.bin", &big)]).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(
        std::fs::metadata(user_dir(&ctx).join("big.bin"))
            .unwrap()
            .len(),
        big.len() as u64
    );

    // the editor reads up to 5MB, so it must be able to save that much too
    let (status, body, _) = send(
        &ctx,
        req(
            &ctx,
            "PUT",
            "/api/files/content?path=notes.txt",
            big.clone(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn multi_file_upload_that_overflows_keeps_accounting_exact() {
    let ctx = setup("u1", 100, false).await;
    let a = "a".repeat(60);
    let b = "b".repeat(60);
    let (status, _, _) = upload(&ctx, "", &[("a.txt", &a), ("b.txt", &b)]).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    // whatever landed before the overflow must be on the books
    assert_accounting_consistent(&ctx).await;
    assert!(staging_leftovers(&ctx).is_empty());

    // and the remaining budget really is what's left: no second 60 bytes fit
    let (status, _, _) = upload(&ctx, "", &[("c.txt", &b)]).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn dotfiles_can_be_uploaded_but_staging_names_cannot() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[(".env", "KEY=1")]).await;
    assert_eq!(status, StatusCode::OK);
    assert!(user_dir(&ctx).join(".env").exists());

    let (status, _, _) = upload(&ctx, "", &[(".rbox-tmp-sneaky", "x")]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/mkdir",
        r#"{"path":".rbox-tmp-x"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn storage_root_cannot_be_renamed_copied_or_moved() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let root = user_dir(&ctx);
    for path in ["", ".", "/"] {
        let (status, _) = json(
            &ctx,
            "POST",
            "/api/files/rename",
            &format!(r#"{{"path":"{path}","new_name":"stolen"}}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "rename of {path:?}");
    }
    assert!(root.exists(), "user root must survive");
    assert!(!root.parent().unwrap().join("stolen").exists());

    std::fs::create_dir_all(root.join("sub")).unwrap();
    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/copy",
        r#"{"path":"","dest_dir":"sub"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rename_rejects_names_with_separators() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let root = user_dir(&ctx);
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("a.txt"), "a").unwrap();
    for name in ["sub/a.txt", "sub\\a.txt", "..", ".", ""] {
        let (status, _) = json(
            &ctx,
            "POST",
            "/api/files/rename",
            &serde_json::json!({ "path": "a.txt", "new_name": name }).to_string(),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "new_name {name:?}");
    }
    assert!(root.join("a.txt").exists());
}

#[tokio::test]
async fn copying_a_folder_into_itself_is_rejected() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let root = user_dir(&ctx);
    std::fs::create_dir_all(root.join("a/b")).unwrap();
    std::fs::write(root.join("a/f.txt"), "data").unwrap();
    rbox::users::set_used_bytes(
        &rusqlite::Connection::open(rbox::db::db_path(ctx.dir.path())).unwrap(),
        1,
        4,
    )
    .unwrap();
    for dest in ["a", "a/b"] {
        let (status, _) = json(
            &ctx,
            "POST",
            "/api/files/copy",
            &format!(r#"{{"path":"a","dest_dir":"{dest}"}}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "copy a -> {dest}");
    }
    assert!(!root.join("a/b/a").exists());
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn copy_is_atomic_and_accounted() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("x.txt", "12345")]).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json(&ctx, "POST", "/api/files/mkdir", r#"{"path":"d"}"#).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/copy",
        r#"{"path":"x.txt","dest_dir":"d"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(user_dir(&ctx).join("d/x.txt")).unwrap(),
        "12345"
    );
    assert!(staging_leftovers(&ctx).is_empty());
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn failed_extraction_leaves_no_hidden_staging_data() {
    let ctx = setup("u1", 4096, false).await;
    let archive = zip_bytes(&[("one.bin", &[1u8; 1500]), ("two.bin", &[2u8; 3000])]);
    std::fs::write(user_dir(&ctx).join("big.zip"), &archive).unwrap();
    rbox::users::set_used_bytes(
        &rusqlite::Connection::open(rbox::db::db_path(ctx.dir.path())).unwrap(),
        1,
        archive.len() as u64,
    )
    .unwrap();

    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"big.zip","dest_dir":"out"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(
        staging_leftovers(&ctx).is_empty(),
        "staging dir leaked: {:?}",
        staging_leftovers(&ctx)
    );
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn extraction_conflict_moves_nothing() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let root = user_dir(&ctx);
    let archive = zip_bytes(&[("alpha.txt", b"aaaa"), ("zeta.txt", b"zzzz")]);
    std::fs::write(root.join("pair.zip"), &archive).unwrap();
    std::fs::create_dir_all(root.join("out")).unwrap();
    std::fs::write(root.join("out/zeta.txt"), "existing").unwrap();
    rbox::users::set_used_bytes(
        &rusqlite::Connection::open(rbox::db::db_path(ctx.dir.path())).unwrap(),
        1,
        rbox::storage::disk_usage(&root),
    )
    .unwrap();

    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"pair.zip","dest_dir":"out"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(!root.join("out/alpha.txt").exists(), "partial extraction");
    assert!(staging_leftovers(&ctx).is_empty());
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn archive_creation_never_overwrites() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("a.txt", "alpha"), ("keep.zip", "precious")]).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/archive",
        r#"{"paths":["a.txt"],"dest_path":"keep.zip","format":"zip"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        std::fs::read_to_string(user_dir(&ctx).join("keep.zip")).unwrap(),
        "precious"
    );
    assert_accounting_consistent(&ctx).await;
}

#[tokio::test]
async fn share_bookkeeping_is_exact_about_paths() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let root = user_dir(&ctx);
    // case-sensitive siblings plus a name containing a LIKE wildcard
    for d in ["Docs", "docs", "a_c", "abc"] {
        std::fs::create_dir_all(root.join(d)).unwrap();
        std::fs::write(root.join(d).join("f.txt"), d).unwrap();
    }
    let mk = |p: &'static str| {
        let ctx = &ctx;
        async move {
            let (s, v) = json(ctx, "POST", "/api/shares", &format!(r#"{{"path":"{p}"}}"#)).await;
            assert_eq!(s, StatusCode::OK);
            v["token"].as_str().unwrap().to_string()
        }
    };
    mk("docs/f.txt").await;
    mk("abc/f.txt").await;

    let (status, _) = json(&ctx, "DELETE", "/api/files?path=Docs", "").await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json(
        &ctx,
        "POST",
        "/api/files/rename",
        r#"{"path":"a_c","new_name":"renamed"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, v) = json(&ctx, "GET", "/api/shares", "").await;
    let mut paths: Vec<&str> = v["shares"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["path"].as_str().unwrap())
        .collect();
    paths.sort();
    assert_eq!(paths, ["abc/f.txt", "docs/f.txt"]);
}

#[tokio::test]
async fn inline_share_content_cannot_run_script_on_our_origin() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let (status, _, _) = upload(
        &ctx,
        "",
        &[("evil.html", "<script>fetch('/api/admin/users')</script>")],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, v) = json(&ctx, "POST", "/api/shares", r#"{"path":"evil.html"}"#).await;
    let token = v["token"].as_str().unwrap();

    let (status, headers, _) = send_full(
        &ctx,
        Request::builder()
            .uri(format!("/s/{token}/raw"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let csp = headers["content-security-policy"].to_str().unwrap();
    assert!(csp.contains("sandbox"), "csp: {csp}");
}

#[tokio::test]
async fn landing_page_escapes_names_exactly_once() {
    let ctx = setup("u1", 1024 * 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("Q&A.txt", "x")]).await;
    assert_eq!(status, StatusCode::OK);
    let (_, v) = json(&ctx, "POST", "/api/shares", r#"{"path":"Q&A.txt"}"#).await;
    let token = v["token"].as_str().unwrap();
    let (status, _, body) = send_full(
        &ctx,
        Request::builder()
            .uri(format!("/s/{token}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(body).unwrap();
    assert!(html.contains("Q&amp;A.txt"));
    assert!(!html.contains("&amp;amp;"), "double-escaped");

    // a landing page for a share whose file vanished still renders the app
    std::fs::remove_file(user_dir(&ctx).join("Q&A.txt")).unwrap();
    let (status, headers, _) = send_full(
        &ctx,
        Request::builder()
            .uri(format!("/s/{token}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
}

async fn try_login(app: &axum::Router, user: &str, pass: &str, xff: &str) -> StatusCode {
    let body = serde_json::json!({ "username": user, "password": pass });
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .header("x-forwarded-for", xff)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn spoofed_forwarded_for_does_not_reset_the_rate_limit() {
    let ctx = setup("u1", 1024, false).await;
    for i in 0..5 {
        let s = try_login(&ctx.app, "u1", "wrongpass", &format!("10.0.0.{i}")).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
    let s = try_login(&ctx.app, "u1", "wrongpass", "10.0.0.99").await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn share_passwords_are_rate_limited() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("s.txt", "secret")]).await;
    assert_eq!(status, StatusCode::OK);
    let (_, v) = json(
        &ctx,
        "POST",
        "/api/shares",
        r#"{"path":"s.txt","password":"correct-horse"}"#,
    )
    .await;
    let token = v["token"].as_str().unwrap().to_string();
    let get = |pw: &str| {
        Request::builder()
            .uri(format!("/s/{token}/download?password={pw}"))
            .body(Body::empty())
            .unwrap()
    };
    let mut statuses = Vec::new();
    for i in 0..12 {
        let (s, _, _) = send_full(&ctx, get(&format!("guess{i}"))).await;
        statuses.push(s);
    }
    assert!(
        statuses.contains(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );
    // the lockout covers the right password too, until the window passes
    let (s, _, _) = send_full(&ctx, get("correct-horse")).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn sessions_survive_a_server_restart() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _) = json(&ctx, "GET", "/api/auth/me", "").await;
    assert_eq!(status, StatusCode::OK);

    // a fresh process on the same data dir, same cookie
    let app2 = router::build(AppState::new(ctx.dir.path()).unwrap());
    let res = app2
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header("cookie", &ctx.cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // and the raw token is never what's stored on disk
    let token = ctx.cookie.split('=').nth(1).unwrap();
    let raw = std::fs::read(rbox::db::db_path(ctx.dir.path())).unwrap();
    assert!(!raw.windows(token.len()).any(|w| w == token.as_bytes()));
}

#[tokio::test]
async fn logout_is_durable_across_restart() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _) = json(&ctx, "POST", "/api/auth/logout", "").await;
    assert_eq!(status, StatusCode::OK);
    let app2 = router::build(AppState::new(ctx.dir.path()).unwrap());
    let res = app2
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header("cookie", &ctx.cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_password_reset_signs_the_user_out() {
    let ctx = setup("root", 1024, true).await;
    let (status, _) = json(
        &ctx,
        "POST",
        "/api/admin/users",
        r#"{"username":"bob","password":"bobspassword","quota_bytes":1024}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let bob = login(&ctx.app, "bob", "bobspassword").await;

    let (status, _) = json(
        &ctx,
        "PATCH",
        "/api/admin/users/bob",
        r#"{"password":"brand-new-pass"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let res = ctx
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header("cookie", &bob)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn rejected_admin_update_changes_nothing() {
    let ctx = setup("root", 1024, true).await;
    // demoting the only admin fails; the quota in the same request must not stick
    let (status, _) = json(
        &ctx,
        "PATCH",
        "/api/admin/users/root",
        r#"{"quota_bytes":5,"is_admin":false}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, v) = json(&ctx, "GET", "/api/admin/users", "").await;
    assert_eq!(v["users"][0]["quota_bytes"], 1024);
}

#[tokio::test]
async fn binary_files_get_a_clear_editor_error() {
    let ctx = setup("u1", 1024, false).await;
    std::fs::write(user_dir(&ctx).join("blob.bin"), [0xff, 0xfe, 0x00, 0x80]).unwrap();
    let (status, v) = json(&ctx, "GET", "/api/files/content?path=blob.bin", "").await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert!(v["error"].as_str().unwrap().contains("text"));
}

#[tokio::test]
async fn ui_assets_are_served_gzipped_when_accepted() {
    let ctx = setup("u1", 1024, false).await;
    for (accept, gzipped) in [("gzip, deflate, br", true), ("identity", false)] {
        let (status, headers, body) = send_full(
            &ctx,
            Request::builder()
                .uri("/")
                .header("accept-encoding", accept)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            headers.contains_key("content-encoding"),
            gzipped,
            "{accept}"
        );
        assert_eq!(headers["vary"], "accept-encoding");
        if gzipped {
            let mut html = String::new();
            std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(&body[..]), &mut html)
                .unwrap();
            assert!(html.contains("id=\"root\""));
        }
    }
}

#[tokio::test]
async fn new_file_never_clobbers_an_existing_one() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("notes.md", "keep me")]).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = send(
        &ctx,
        req(&ctx, "PUT", "/api/files/content?path=notes.md&create=1", ""),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        std::fs::read_to_string(user_dir(&ctx).join("notes.md")).unwrap(),
        "keep me"
    );
    let (status, _, _) = send(
        &ctx,
        req(&ctx, "PUT", "/api/files/content?path=fresh.md&create=1", ""),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_accounting_consistent(&ctx).await;
}
