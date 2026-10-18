# rbox

rbox is a self-hosted, multi-user file server that compiles to a single static
binary: the Rust backend, an embedded React/MUI web interface, and a
SQLite database all ship in one executable. Every user gets an isolated storage
directory with a hard byte quota enforced while uploads stream, so the server
never overcommits disk.

## Install

```
curl -fsSL https://raw.githubusercontent.com/FolderFile/rBox/main/install.sh | sh
```

The script picks the right release asset for your platform (static musl
builds for Linux, universal binaries for macOS and Windows on x64 and arm64)
and installs to `/usr/local/bin`, falling back to
`sudo`/`$HOME/.local/bin` as needed. `RBOX_VERSION` and `RBOX_INSTALL_DIR`
override the defaults. See `install.sh` for details.

## Quickstart

```
rbox init --data-dir /var/lib/rbox
rbox --data-dir /var/lib/rbox user add alice --password 'somelongpass' --quota 10GB
rbox --data-dir /var/lib/rbox serve --bind 0.0.0.0 --port 8000
```

`rbox init` prompts for the admin password when `--admin-password` is omitted.

## CLI

| Command | Description |
| --- | --- |
| `rbox init` | Create data dir, database, and initial admin account |
| `rbox serve` | Start the HTTP server |
| `rbox user add <name> --password <p> --quota <size>` | Add a user (sizes like `500MB`, `10GB`, `1.5GiB`) |
| `rbox user list` | List users, quotas, and usage |
| `rbox user quota <name> <size>` | Change a user's quota |
| `rbox user delete <name> [--purge]` | Delete a user, optionally with their files |
| `rbox user recalc [name]` | Recalculate used bytes from disk |

`--data-dir` defaults to `/var/lib/rbox` and is global.

## Architecture notes

- **Quota accounting is transactional.** Uploads stream to a staging file next
  to their target; `used_bytes` is updated in a single SQLite transaction only
  after the file lands. Exceeding the quota mid-stream aborts the upload,
  deletes the partial file, and returns `413`; the database never sees it.
- **Zero disk-buffer streaming.** Directory downloads are zipped on the fly
  through an in-memory pipe; no temporary archives are written. Downloads
  support `Range` requests for resumable transfers and media scrubbing.
- **Isolation.** Every request path is re-sanitized against the user's root;
  absolute paths and `..` are rejected. Sessions are HttpOnly cookies with
  Argon2 password hashing.
- **Embedded UI.** The web frontend is compiled into the binary via rust-embed.
  Static routes fall back to `index.html` for client-side routing; hashed
  assets carry immutable cache headers.

## Build from source

Requires Node 20+ and a Rust toolchain.

```
npm --prefix web ci
npm --prefix web run build
cargo build --release
```

`web/dist` must exist before `cargo build`, since the frontend is embedded at
compile time. `cargo test` runs the unit and integration suites; the
integration tests spawn the real router on a temp directory.

## HTTP surface (short version)

- `POST /api/auth/login` / `logout` / `GET me`
- `GET|DELETE /api/files`, `POST /api/files/{mkdir,rename,move,copy}`,
  `GET|PUT /api/files/content`, `POST /api/files/upload`,
  `GET /api/files/download`, `GET /api/files/zip`
- `POST|GET /api/shares`, `DELETE /api/shares/{token}`
- `GET /s/{token}` (public SPA view), `GET /s/{token}/info`,
  `GET /s/{token}/download`
- Admin: `GET|POST /api/admin/users`,
  `PATCH|DELETE /api/admin/users/{username}`,
  `POST /api/admin/users/{username}/recalc`

Deleting or moving a shared item updates or removes its share links; listing
shares prunes links whose files were removed from disk. Share links may
optionally carry a password and an expiry timestamp.