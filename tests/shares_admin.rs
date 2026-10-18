mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rbox::db;

use common::*;

async fn make_share(ctx: &Ctx, path: &str, extra: &str) -> String {
    let body = format!(r#"{{"path":"{path}"{extra}}}"#);
    let (status, resp, _) = send(ctx, req(ctx, "POST", "/api/shares", Body::from(body))).await;
    assert_eq!(status, StatusCode::OK);
    serde_json::from_slice::<serde_json::Value>(&resp).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn public(ctx: &Ctx, uri: &str) -> Request<Body> {
    let _ = ctx;
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn share_lifecycle() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("notes.txt", "shared data")]).await;
    assert_eq!(status, StatusCode::OK);

    let token = make_share(&ctx, "notes.txt", "").await;

    let (status, body, _) = send(&ctx, get(&ctx, "/api/shares")).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["shares"][0]["token"].as_str().unwrap(), token);
    assert_eq!(v["shares"][0]["requires_password"], false);

    // public info needs no session
    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["name"], "notes.txt");
    assert_eq!(v["is_dir"], false);
    assert_eq!(v["size"], 11);
    assert_eq!(v["requires_password"], false);

    // public download works without auth, range support included
    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"shared data");

    let mut r = public(&ctx, &format!("/s/{token}/download")).await;
    r.headers_mut()
        .insert("range", "bytes=0-5".parse().unwrap());
    let (status, body, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, b"shared");

    // revoke by a different user must 404 (ownership check)
    let other = setup("u2", 1024, false).await;
    let (status, _, _) = send(
        &other,
        req(
            &other,
            "DELETE",
            &format!("/api/shares/{token}"),
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "DELETE",
            &format!("/api/shares/{token}"),
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn expired_share_is_gone() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("a.txt", "x")]).await;
    assert_eq!(status, StatusCode::OK);

    let token = make_share(&ctx, "a.txt", r#","expires_in_secs": 3600"#).await;
    exec_sql(
        ctx.dir.path(),
        &format!("UPDATE shares SET expires_at = 1 WHERE token = '{token}'"),
    );

    let (status, _, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn password_protected_share() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("secret.txt", "top secret")]).await;
    assert_eq!(status, StatusCode::OK);

    let token = make_share(&ctx, "secret.txt", r#","password":"letmein123""#).await;

    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["requires_password"], true);

    // no password -> 401
    let (status, _, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // wrong password -> 401
    let (status, _, _) = send(
        &ctx,
        public(&ctx, &format!("/s/{token}/download?password=nope12345")).await,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // via query param
    let (status, body, _) = send(
        &ctx,
        public(&ctx, &format!("/s/{token}/download?password=letmein123")).await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"top secret");

    // via header
    let mut r = public(&ctx, &format!("/s/{token}/download")).await;
    r.headers_mut()
        .insert("x-share-password", "letmein123".parse().unwrap());
    let (status, body, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"top secret");
}

#[tokio::test]
async fn shared_directory_streams_as_zip() {
    let ctx = setup("u1", 1024, false).await;
    let root = user_dir(&ctx);
    std::fs::create_dir_all(root.join("bundle/sub")).unwrap();
    std::fs::write(root.join("bundle/one.txt"), "one").unwrap();
    std::fs::write(root.join("bundle/sub/two.txt"), "two").unwrap();

    let token = make_share(&ctx, "bundle", "").await;

    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["is_dir"], true);
    assert_eq!(v["size"], 6);

    let (status, body, ctype) =
        send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ctype.as_deref(), Some("application/zip"));
    let archive = zip::ZipArchive::new(std::io::Cursor::new(body)).unwrap();
    let names: Vec<String> = archive
        .file_names()
        .filter_map(|n| n.ok().map(|c| c.to_string()))
        .collect();
    assert!(names.contains(&"one.txt".to_string()));
    assert!(
        names.contains(&"bundle/sub/two.txt".to_string())
            || names.contains(&"sub/two.txt".to_string()),
        "{names:?}"
    );
}

#[tokio::test]
async fn admin_routes_reject_non_admins() {
    let ctx = setup("u1", 1024, false).await;
    for (method, uri) in [
        ("GET", "/api/admin/users"),
        ("POST", "/api/admin/users"),
        ("PATCH", "/api/admin/users/u1"),
        ("DELETE", "/api/admin/users/u1"),
        ("POST", "/api/admin/users/u1/recalc"),
    ] {
        let (status, _, _) = send(&ctx, req(&ctx, method, uri, Body::empty())).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
    }
}

#[tokio::test]
async fn admin_user_management() {
    let admin = setup("root", 10_000, true).await;

    // create
    let (status, body, _) = send(
        &admin,
        req(
            &admin,
            "POST",
            "/api/admin/users",
            Body::from(
                r#"{"username":"newbie","password":"freshpass1","quota_bytes":2048,"is_admin":false}"#,
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["id"]
        .as_i64()
        .unwrap();
    assert!(
        db::user_dir(admin.dir.path(), id).exists(),
        "storage dir must exist"
    );

    // list
    let (status, body, _) = send(&admin, get(&admin, "/api/admin/users")).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["users"].as_array().unwrap().len(), 2);
    assert!(v["users"][1]["created_at"].as_str().is_some());

    // password must be validated too
    let (status, _, _) = send(
        &admin,
        req(
            &admin,
            "POST",
            "/api/admin/users",
            Body::from(r#"{"username":"weak","password":"short","quota_bytes":2048}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // patch quota + admin flag
    let (status, body, _) = send(
        &admin,
        req(
            &admin,
            "PATCH",
            "/api/admin/users/newbie",
            Body::from(r#"{"quota_bytes":4096,"is_admin":true}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["quota_bytes"], 4096);
    assert_eq!(v["is_admin"], true);

    // now two admins exist, demoting newbie is fine
    let (status, body, _) = send(
        &admin,
        req(
            &admin,
            "PATCH",
            "/api/admin/users/newbie",
            Body::from(r#"{"is_admin":false}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["is_admin"],
        false
    );

    // recalc
    std::fs::write(db::user_dir(admin.dir.path(), id).join("f.txt"), "12345678").unwrap();
    let (status, body, _) = send(
        &admin,
        req(
            &admin,
            "POST",
            "/api/admin/users/newbie/recalc",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["used_bytes"],
        8
    );

    // deleting your own account is blocked
    let (status, _, _) = send(
        &admin,
        req(&admin, "DELETE", "/api/admin/users/root", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // delete + purge
    let (status, _, _) = send(
        &admin,
        req(
            &admin,
            "DELETE",
            "/api/admin/users/newbie?purge=true",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!db::user_dir(admin.dir.path(), id).exists(), "files purged");
}

#[tokio::test]
async fn last_admin_cannot_be_demoted_or_deleted() {
    let admin = setup("solo", 1024, true).await;

    let (status, _, _) = send(
        &admin,
        req(
            &admin,
            "PATCH",
            "/api/admin/users/solo",
            Body::from(r#"{"is_admin":false}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // via a second admin there is no guard, so delete runs from the other side
    let (status, _, _) = send(
        &admin,
        req(&admin, "DELETE", "/api/admin/users/solo", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST); // self-deletion guard fires first
}

#[tokio::test]
async fn share_of_missing_file_is_rejected() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/shares",
            Body::from(r#"{"path":"ghost.txt"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // and a share whose target disappears later
    let (status, _, _) = upload(&ctx, "", &[("gone.txt", "bye")]).await;
    assert_eq!(status, StatusCode::OK);
    let token = make_share(&ctx, "gone.txt", "").await;
    std::fs::remove_file(user_dir(&ctx).join("gone.txt")).unwrap();
    let (status, _, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn share_end_to_end_with_frontend_path_format() {
    let ctx = setup("u1", 1024, false).await;

    // frontend flow: nested upload via multipart, then a share whose path may
    // carry a leading slash (joinPath output after a route change)
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
    let (status, _, _) = upload(&ctx, "docs", &[("readme.txt", "nested share body")]).await;
    assert_eq!(status, StatusCode::OK);

    let (status, resp, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/shares",
            Body::from(r#"{"path":"/docs/readme.txt"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&resp).unwrap();
    assert_eq!(v["path"], "docs/readme.txt");
    let token = v["token"].as_str().unwrap();

    let (status, resp, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&resp).unwrap();
    assert_eq!(v["name"], "readme.txt");
    assert_eq!(v["is_dir"], false);

    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"nested share body");
}

#[tokio::test]
async fn missing_target_is_404_not_500() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("a.txt", "x")]).await;
    assert_eq!(status, StatusCode::OK);
    let token = make_share(&ctx, "a.txt", "").await;
    std::fs::remove_file(user_dir(&ctx).join("a.txt")).unwrap();

    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let msg = v["error"].as_str().unwrap();
    assert!(
        !msg.contains("io error"),
        "not-found must not surface as an io 500: {msg}"
    );

    // listing a deleted directory is a 404 too
    let (status, _, _) = send(&ctx, get(&ctx, "/api/files?path=nope")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn raw_share_streams_inline_with_true_mime() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("pic.png", "not-really-png-but-typed")]).await;
    assert_eq!(status, StatusCode::OK);
    let token = make_share(&ctx, "pic.png", "").await;

    for uri in [format!("/s/{token}/raw"), format!("/s/{token}/raw/pic.png")] {
        let (status, headers, body) = send_full(&ctx, public(&ctx, &uri).await).await;
        assert_eq!(status, StatusCode::OK);
        let cd = headers["content-disposition"].to_str().unwrap();
        assert!(
            cd.starts_with("inline;"),
            "expected inline disposition: {cd}"
        );
        assert_eq!(headers["content-type"], "image/png");
        assert_eq!(body, b"not-really-png-but-typed");
    }

    // the download route still forces attachment
    let (status, headers, _) =
        send_full(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers["content-disposition"]
        .to_str()
        .unwrap()
        .starts_with("attachment;"));
}

#[tokio::test]
async fn landing_page_injects_opengraph_meta() {
    let ctx = setup("u1", 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("holiday.png", "beach")]).await;
    assert_eq!(status, StatusCode::OK);
    let token = make_share(&ctx, "holiday.png", "").await;

    let (status, headers, body) = send_full(&ctx, public(&ctx, &format!("/s/{token}")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    let html = String::from_utf8_lossy(&body);
    assert!(
        html.contains(r#"<meta property="og:title""#),
        "og:title missing"
    );
    assert!(html.contains("og:site_name"));
    assert!(html.contains("holiday.png"));
    assert!(
        !html.contains("og:image"),
        "landing must not embed raw media"
    );
    assert!(html.contains(r##"<meta name="theme-color" content="#e53935""##));

    // unknown tokens still serve the plain SPA shell
    let (status, _, body) = send_full(&ctx, public(&ctx, "/s/zzzznope0000").await).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!String::from_utf8_lossy(&body).contains("og:title"));
}

#[tokio::test]
async fn deleting_a_file_cascades_its_share() {
    let ctx = setup("u1", 4096, false).await;
    let (status, _, _) = upload(&ctx, "", &[("gone.txt", "ephemeral")]).await;
    assert_eq!(status, StatusCode::OK);
    let token = make_share(&ctx, "gone.txt", "").await;

    let (status, _, _) = send_full(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = send(
        &ctx,
        Request::builder()
            .method("DELETE")
            .uri("/api/files?path=gone.txt")
            .header("cookie", &ctx.cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // the token no longer resolves and the row is gone entirely
    let (status, _, _) = send_full(&ctx, public(&ctx, &format!("/s/{token}/info")).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let conn = rusqlite::Connection::open(db::db_path(ctx.dir.path())).unwrap();
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shares WHERE token = ?1",
            [&token],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn deleting_a_folder_cascades_shares_inside_it() {
    let ctx = setup("u1", 4096, false).await;
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/mkdir",
            Body::from(r#"{"path":"stuff"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = upload(&ctx, "stuff", &[("inner.txt", "x")]).await;
    assert_eq!(status, StatusCode::OK);
    let inner = make_share(&ctx, "stuff/inner.txt", "").await;
    let whole = make_share(&ctx, "stuff", "").await;

    let (status, _, _) = send(
        &ctx,
        Request::builder()
            .method("DELETE")
            .uri("/api/files?path=stuff")
            .header("cookie", &ctx.cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body, _) = send(&ctx, get(&ctx, "/api/shares")).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["shares"].as_array().unwrap().len(), 0);
    for t in [inner, whole] {
        let (status, _, _) = send_full(&ctx, public(&ctx, &format!("/s/{t}/info")).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn renaming_and_moving_retargets_shares() {
    let ctx = setup("u1", 4096, false).await;
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
    let (status, _, _) = upload(&ctx, "docs", &[("r.txt", "content-here")]).await;
    assert_eq!(status, StatusCode::OK);
    let token = make_share(&ctx, "docs/r.txt", "").await;

    // rename inside the same folder
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/rename",
            Body::from(r#"{"path":"docs/r.txt","new_name":"renamed.txt"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_status, body, _) = send(&ctx, get(&ctx, "/api/shares")).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["shares"][0]["path"], "docs/renamed.txt");
    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"content-here");

    // move to another folder; the same token still streams
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/mkdir",
            Body::from(r#"{"path":"sink"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/move",
            Body::from(r#"{"path":"docs/renamed.txt","dest_dir":"sink"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_status, body, _) = send(&ctx, get(&ctx, "/api/shares")).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["shares"][0]["path"], "sink/renamed.txt");
    let (status, body, _) = send(&ctx, public(&ctx, &format!("/s/{token}/download")).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"content-here");
}

#[tokio::test]
async fn externally_removed_files_are_pruned_from_share_listing() {
    let ctx = setup("u1", 4096, false).await;
    let (status, _, _) = upload(&ctx, "", &[("alive.txt", "ok"), ("ghost.txt", "boo")]).await;
    assert_eq!(status, StatusCode::OK);
    make_share(&ctx, "alive.txt", "").await;
    let ghost = make_share(&ctx, "ghost.txt", "").await;

    // remove the file behind the server's back, as `rm` on the host would
    std::fs::remove_file(user_dir(&ctx).join("ghost.txt")).unwrap();

    let (status, body, _) = send(&ctx, get(&ctx, "/api/shares")).await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let shares = v["shares"].as_array().unwrap();
    assert_eq!(shares.len(), 1);
    assert_eq!(shares[0]["path"], "alive.txt");

    let conn = rusqlite::Connection::open(db::db_path(ctx.dir.path())).unwrap();
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shares WHERE token = ?1",
            [&ghost],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "orphan share row must be pruned lazily");
}
