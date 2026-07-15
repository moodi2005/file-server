# File Server

Uploads, stores and serves files on a single node. Multi-core, with no external
service beyond the access endpoint used for auth.

## API

### Upload

```
PUT /upload          (POST also accepted)
```

| Header     | Required | Meaning                                        |
| ---------- | -------- | ---------------------------------------------- |
| `token`    | yes      | User token, verified against `accessUrl`       |
| `compress` | no       | `true` / `1` to queue compression              |
| `webp`     | no       | `true` / `1` to convert to webp                |
| `resize`   | no       | `true` / `1` to downscale according to `level` |
| `level`    | no       | `0`–`10`, default `5`. Higher = smaller        |

Body is `multipart/form-data`, up to `maxFilesPerRequest` files per request.

Response — one string per uploaded file, in request order:

```json
["n1-202608-a3f2b8c19d4e/image.png"]
```

**Store that string.** It is all you need: it addresses the file and carries the
display name.

```js
const name = ref.split("/").pop();               // "image.png"
const url  = `${base}/f/${ref}?token=${token}`;  // download link
```

Two files uploaded under the same name get different strings and never collide:
the name is a label, the id is the key.

### Download

```
GET /f/<ref>?token=<token>
GET /f/<id>?token=<token>      # the name half is optional
```

Supports `Range` (206 / 416) and `ETag` / `If-None-Match`. Always served as
`Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`, so
nothing stored here can execute in a browser.

If a compression job converted the file, the download name follows the real
format: `image.png` converted to webp downloads as `image.webp`.

### Health

```
GET /health
```

Queue depth, access-cache size, breaker state.

## Auth

Every request is checked against `accessUrl`:

```
POST <accessUrl>
headers: token: <token>
body:    { "policy": "fileServer", "part": "upload" | "download", "onlyToken": bool }
```

A non-200 is passed through to the caller. Results are cached for
`accessCacheTtl` (default 10s), which is also the revocation delay — keep it
short. Failures are cached too, and a breaker opens after repeated transport
errors so a dead access service cannot stall every worker.

**The server refuses to start without `accessUrl`.** There is no mode in which
auth is off.

## Storage layout

```
/data
  tmp/                                    in-flight uploads and job output
  blobs/2026/08/<bucketId>/<fileId>.webp  up to bucketSize files per bucket
  files.db                                id, original name, path, size, hash
  jobs.db                                 compression queue (its own write lock)
```

Uploaded filenames never reach the filesystem — the on-disk name is the file id,
and the real name lives in `files.db`. That removes collisions, unicode problems
and length limits in one move.

Files land in `tmp/` first and are renamed into place. `rename` is atomic within
one filesystem, so a download never sees a half-written file. **`tmp/` must stay
inside the same volume as `blobs/`**, or the rename fails with `EXDEV` and every
upload breaks.

## Configuration

| Variable                  | Default      | Notes                                          |
| ------------------------- | ------------ | ---------------------------------------------- |
| `port`                    | `2005`       |                                                |
| `dataDir`                 | `./data`     | Must be a persistent volume                    |
| `nodeId`                  | `n1`         | Baked into every id; unique per node           |
| `httpWorkers`             | cores        | cgroup-aware; **set it if you use `--cpus`**   |
| `jobWorkers`              | `2`          | Compression processes, kept off the http path  |
| `bucketSize`              | `5000`       | Files per bucket directory                     |
| `maxFileSize`             | `104857600`  | Per file                                       |
| `maxFilesPerRequest`      | `10`         |                                                |
| `maxBytesPerUserPerDay`   | `3221225472` | 3 GB per user per UTC day. `0` disables        |
| `maxUploadsPerUserPerDay` | `10000`      | `0` disables                                   |
| `minFreeDiskBytes`        | `5368709120` | Below this, uploads answer `507`               |
| `minFreeDiskPercent`      | `5`          | Whichever floor is higher wins                 |
| `accessUrl`               | —            | **Required**                                   |
| `accessPolicy`       | `fileServer` | Sent as `policy`                               |
| `accessPartUpload`   | `upload`     | Sent as `part` on upload                       |
| `accessPartDownload` | `download`   | Sent as `part` on download                     |
| `accessCacheTtl`     | `10000`      | ms; doubles as revocation delay                |
| `accessTimeout`      | `2000`       | ms                                             |
| `legacyDir`          | unset        | Old `uploads/` tree, served read-only          |
| `logLevel`           | `info`       |                                                |

Dates and directories are UTC. Do not set `TZ` — a timezone change would
scatter the date folders.

### Limits

Uploads are capped **per user, per UTC day** (3 GB by default), keyed on the
`_id` the access service returns. A lifetime cap would eventually lock the
server out permanently; a daily ceiling bounds how fast the disk fills while
letting the service run forever.

Separately, uploads stop with `507` once free space drops under
`minFreeDiskBytes` / `minFreeDiskPercent`. Since files are never deleted, a full
disk is a matter of when — and a full disk takes SQLite down with it, so the
whole node fails rather than just the endpoint that filled it. Watch
`/health` → `disk.freePercent`.

## Building

```bash
yarn build     # tsc -> build/
yarn bundle    # tsc + esbuild -> dist/index.js, single minified file
yarn test
```

The Docker image ships `dist/` only — no source tree. `dist/index.js.map` is
produced but deliberately kept out of the image: **keep it**, or production
stack traces are unreadable.

## Running

```bash
docker build -t fileserver .

docker run -d \
  -v /srv/fileserver:/data \
  -e accessUrl=http://user/access \
  -e nodeId=n1 \
  --ulimit nofile=65535 \
  --init \
  -p 2005:2005 \
  fileserver
```

`--init` matters: node as PID 1 does not reap the workers it forks.

The volume must be owned by uid 1000, or the container's `node` user cannot
write to it:

```bash
chown -R 1000:1000 /srv/fileserver
```

### Host filesystem

```bash
mkfs.xfs /dev/sdb
# /etc/fstab
/dev/sdb  /srv/fileserver  xfs  defaults,noatime,nodiratime  0 0
```

XFS allocates inodes dynamically. ext4 fixes the count at mkfs time and cannot
grow it, so a busy server can hit `No space left on device` with the disk half
empty. If ext4 is unavoidable, size it up front: `mkfs.ext4 -N 20000000`.

`noatime` matters more than it looks — without it, every read writes an access
timestamp back to disk.

**SQLite must be on local disk.** Its locking is broken over NFS and the
database will corrupt.

## Multiple nodes

The node id is part of every file id (`n1-202608-…`), so any node can tell from
an id alone which node holds the file. Nothing is shared, and adding a node
rebalances nothing: start `n2`, new uploads land there, existing ids keep
pointing at `n1`.

## Legacy files

Point `legacyDir` at the old `uploads/` tree and the urls the previous server
handed out keep resolving at `GET /<legacyUrlPrefix>/<path>?token=…`. Nothing is
moved or rewritten. Migrating those files into the new layout is a separate
step.

## Development

```bash
yarn build
yarn test
yarn start
```
