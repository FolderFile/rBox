mod common;

use axum::body::Body;
use axum::http::StatusCode;
use common::*;

async fn req_body(ctx: &Ctx, method: &str, uri: &str, body: &str) -> (StatusCode, Vec<u8>) {
    let (status, bytes, _) = send(ctx, req(ctx, method, uri, Body::from(body.to_string()))).await;
    (status, bytes)
}

#[tokio::test]
async fn zip_roundtrip_and_listing() {
    let ctx = setup("u1", 100 * 1024, false).await;
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
    let (status, _, _) = upload(&ctx, "docs", &[("a.txt", "alpha"), ("b.txt", "beta")]).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/files/archive",
        r#"{"paths":["docs"],"dest_path":"docs.zip","format":"zip","level":9}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(v["size"].as_u64().unwrap() > 0);

    let (status, body) = req_body(&ctx, "GET", "/api/files/archive/list?path=docs.zip", "").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let names: Vec<&str> = v["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"docs/a.txt"), "{names:?}");
    assert_eq!(v["entries"][0]["encrypted"], false);

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"docs.zip","dest_dir":"out"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let out = user_dir(&ctx).join("out/docs/a.txt");
    assert_eq!(std::fs::read_to_string(&out).unwrap(), "alpha");
}

#[tokio::test]
async fn password_protected_zip() {
    let ctx = setup("u1", 100 * 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("secret.txt", "classified")]).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = req_body(
        &ctx,
        "POST",
        "/api/files/archive",
        r#"{"paths":["secret.txt"],"dest_path":"s.zip","format":"zip","level":6,"password":"hunter22"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // listing without the password reports what the frontend needs to prompt
    let (status, body) = req_body(&ctx, "GET", "/api/files/archive/list?path=s.zip", "").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["error"], "password_required");
    assert_eq!(v["encrypted"], true);

    let (status, body) = req_body(
        &ctx,
        "GET",
        "/api/files/archive/list?path=s.zip&password=hunter22",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["entries"][0]["encrypted"], true);

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"s.zip","dest_dir":"out"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "password_required"
    );

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"s.zip","dest_dir":"out","password":"wrong"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "invalid_archive_password"
    );

    let (status, _) = req_body(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"s.zip","dest_dir":"out","password":"hunter22"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(user_dir(&ctx).join("out/secret.txt")).unwrap(),
        "classified"
    );
}

#[tokio::test]
async fn tar_variants_roundtrip() {
    for (format, name) in [("tar.gz", "a.tgz"), ("tar.zst", "a.tar.zst")] {
        let ctx = setup("u1", 100 * 1024, false).await;
        let (status, _, _) = upload(&ctx, "", &[("note.txt", "tarball body")]).await;
        assert_eq!(status, StatusCode::OK);

        let body = format!(
            r#"{{"paths":["note.txt"],"dest_path":"{name}","format":"{format}","level":6}}"#
        );
        let (status, resp) = req_body(&ctx, "POST", "/api/files/archive", &body).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{format}: {}",
            String::from_utf8_lossy(&resp)
        );

        let (status, resp) = req_body(
            &ctx,
            "GET",
            &format!("/api/files/archive/list?path={name}"),
            "",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{format}: {}",
            String::from_utf8_lossy(&resp)
        );

        let body = format!(r#"{{"path":"{name}","dest_dir":"x"}}"#);
        let (status, resp) = req_body(&ctx, "POST", "/api/files/extract", &body).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{format}: {}",
            String::from_utf8_lossy(&resp)
        );
        assert_eq!(
            std::fs::read_to_string(user_dir(&ctx).join("x/note.txt")).unwrap(),
            "tarball body"
        );
    }
}

#[tokio::test]
async fn zip_slip_is_rejected() {
    let ctx = setup("u1", 100 * 1024, false).await;
    let dir = user_dir(&ctx);
    let evil = dir.join("evil.zip");
    {
        let f = std::fs::File::create(&evil).unwrap();
        let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f));
        let opts = zip::write::SimpleFileOptions::default();
        w.start_file("../escape.txt", opts).unwrap();
        w.write_all(b"pwned").unwrap();
        w.finish().unwrap();
    }

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"evil.zip","dest_dir":"out"}"#,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "{}",
        String::from_utf8_lossy(&body)
    );
    // nothing extracted, nothing escaped the user root
    assert!(!dir.join("escape.txt").exists());
    assert!(!dir.join("out").exists());
}

#[tokio::test]
async fn extraction_respects_quota() {
    // plenty of room to build the archive, then the quota shrinks below the
    // uncompressed payload so extraction hits the zip-bomb guard
    let ctx = setup("u1", 10 * 1024 * 1024, false).await;
    let (status, _, _) = upload(&ctx, "", &[("big.txt", "x".repeat(8 * 1024).as_str())]).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = req_body(
        &ctx,
        "POST",
        "/api/files/archive",
        r#"{"paths":["big.txt"],"dest_path":"big.zip","format":"zip","level":0}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    exec_sql(
        ctx.dir.path(),
        "UPDATE users SET quota_bytes = used_bytes + 1024",
    );

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/files/extract",
        r#"{"path":"big.zip","dest_dir":"out"}"#,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "{}",
        String::from_utf8_lossy(&body)
    );
    // nothing partially extracted
    assert!(!user_dir(&ctx).join("out").exists());
}

#[tokio::test]
async fn stat_and_search() {
    let ctx = setup("u1", 100 * 1024, false).await;
    let (status, _, _) = send(
        &ctx,
        req(
            &ctx,
            "POST",
            "/api/files/mkdir",
            Body::from(r#"{"path":"deep"}"#),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = upload(&ctx, "deep", &[("report.txt", "find me")]).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = req_body(&ctx, "GET", "/api/files/stat?path=deep/report.txt", "").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["size"], 7);
    assert_eq!(v["mime"], "text/plain");
    assert_eq!(v["sha256"].as_str().unwrap().len(), 64);

    let (status, body) = req_body(&ctx, "GET", "/api/files/search?q=report&type=doc", "").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["results"][0]["path"], "deep/report.txt");
}

#[tokio::test]
async fn login_rate_limiting() {
    let ctx = setup("u1", 1024, false).await;

    for _ in 0..5 {
        let body = serde_json::json!({ "username": "u1", "password": "wrongpass" });
        let res = ctx
            .app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
    // the cap applies even with correct credentials until the window passes
    let body = serde_json::json!({ "username": "u1", "password": "password123" });
    let res = ctx
        .app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn password_change_and_session_revocation() {
    let ctx = setup("u1", 1024, false).await;

    // second session for the same user
    let cookie2 = login(&ctx.app, "u1", "password123").await;

    let (status, body) = req_body(
        &ctx,
        "POST",
        "/api/auth/password",
        r#"{"current_password":"password123","new_password":"newsecret99"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));

    // the other session died, the current one survives
    let mut r = req(&ctx, "GET", "/api/auth/me", Body::empty());
    r.headers_mut().insert("cookie", cookie2.parse().unwrap());
    let (status, _, _) = send(&ctx, r).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = req_body(&ctx, "GET", "/api/auth/me", "").await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = req_body(&ctx, "GET", "/api/auth/sessions", "").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let list = v["sessions"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["current"], true);

    let id = list[0]["id"].as_u64().unwrap();
    let (status, _body) = req_body(&ctx, "DELETE", &format!("/api/auth/sessions/{id}"), "").await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = req_body(&ctx, "GET", "/api/auth/me", "").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

use std::io::Write as _;
use tower::ServiceExt;
