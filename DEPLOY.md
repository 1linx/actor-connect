# Deploying to an AWS micro instance

Target: `https://movie-connect.r2d20.com`, everything under `~/actor-connect`,
Caddy in front, PM2 keeping it up.

The app listens on **127.0.0.1:9091** — loopback only, so Caddy is the only
thing that can reach it. Port 9091 rather than 9090 so it can sit alongside
actor-search on the same instance.

## 1. DNS and the security group

- An **A record** for `movie-connect.r2d20.com` pointing at the instance's
  public IP. Use an Elastic IP unless you enjoy redoing this after a stop/start.
- Inbound rules: **80** and **443** open to `0.0.0.0/0` (Caddy needs 80 to
  answer the ACME HTTP challenge, and to redirect), **22** from your own IP.
  **Do not open 9091.**

Let DNS resolve before installing Caddy, or the first certificate attempt fails
and you wait out a retry.

## 2. Instance prep

```sh
sudo apt update && sudo apt upgrade -y

# Node 24, to match what this was built against. Node 20.6+ is the real floor,
# for the --env-file flag PM2 uses to load secrets.
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git

# better-sqlite3 ships prebuilt binaries and normally needs none of this, but
# if it ever falls back to compiling, it needs these and will fail loudly
# without them.
sudo apt install -y build-essential python3
```

**Add swap.** A micro instance has 1 GB, and `npm run build` on 1 GB is the
step that gets OOM-killed:

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

*(Alternative: build on your laptop and `rsync` the `build/` directory up. Then
the instance never needs swap or dev dependencies. The swap route is simpler to
maintain, so start there.)*

## 3. The app

```sh
git clone <your-remote> ~/actor-connect
cd ~/actor-connect

# Secrets. Only the TMDB key belongs here — everything else is in
# ecosystem.config.cjs. Gitignored, and Node reads it directly so the key never
# reaches `pm2 describe` or ~/.pm2/dump.pm2.
cp .env.example .env
nano .env            # paste your TMDB key
chmod 600 .env

npm ci
npm run build
mkdir -p logs
```

`data/` is created on first run, and the database is seeded from
`src/lib/server/library.json`, so the app comes up with puzzles in it and needs
no further setup.

Check it before involving Caddy:

```sh
node --env-file=.env build/index.js
# in another shell:
curl -sI http://127.0.0.1:3000/     # 200 — note: plain `node build` uses 3000
```

Ctrl-C, then hand it to PM2.

## 4. PM2

```sh
sudo npm install -g pm2
cd ~/actor-connect
pm2 start ecosystem.config.cjs
pm2 save                              # remember this process list
pm2 startup                           # prints a sudo command — run it
```

```sh
pm2 status
pm2 logs actor-connect --lines 50
curl -sI http://127.0.0.1:9091/       # expect 200
```

## 5. Caddy

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
movie-connect.r2d20.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:9091
}
```

That's the whole thing — Caddy gets the certificate, renews it, and redirects
80 → 443 on its own. Caddy also sets the `X-Forwarded-*` headers, though this
app doesn't need them: `ORIGIN` is set explicitly in `ecosystem.config.cjs`.

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -sI https://movie-connect.r2d20.com/
```

## 6. Two things to decide

### The puzzle builder

`/build` (both builders), `/api/search`, `/api/links`, `/api/cast`,
`/api/filmography` and `/api/puzzles` spend the TMDB key and edit the puzzle
set, so they return **404 in production** unless you set `PUZZLE_EDITOR=1`. Two ways to live with that:

**Author locally (recommended).** Build puzzles on your laptop, hit **Write to
library.json** in the builder, commit, deploy. The seed file is the source of
truth, puzzles are version-controlled, and nothing authoring-related is exposed
publicly.

**Or open it behind Caddy auth.** Uncomment `PUZZLE_EDITOR: '1'` in
`ecosystem.config.cjs`, then put a password in front of it — otherwise anyone
who finds the URL can run up calls on your key:

```caddyfile
movie-connect.r2d20.com {
	encode zstd gzip

	@editor path /build* /api/search* /api/links* /api/cast* /api/filmography* /api/puzzles*
	basic_auth @editor {
		alistair <bcrypt-hash-from-caddy-hash-password>
	}

	reverse_proxy 127.0.0.1:9091
}
```

Generate the hash with `caddy hash-password`. On Caddy older than 2.8 the
directive is spelled `basicauth`.

### Who may iframe it

`src/hooks.server.ts` deliberately strips `X-Frame-Options` so your Laravel app
can embed the game. That leaves it framable by anyone. To narrow it to your own
sites, add to the site block:

```caddyfile
	header Content-Security-Policy "frame-ancestors 'self' https://your-laravel-app.example"
```

Use `frame-ancestors`, not `X-Frame-Options` — the latter can't express an
allowlist, and Caddy adding it back would break the embed.

## 7. Getting new or edited puzzles live

Puzzles are authored **locally** and travel to production **in git**, inside
`src/lib/server/library.json`.

On your laptop:

```sh
npm run dev
# build or edit puzzles at /build, /build/walk, or /build?edit=<id>
```

Then, in the builder, click **Write to library.json** — this is the step that
matters, and it's easy to forget. Puzzles live in your local SQLite database
until you export them, and the database is gitignored.

```sh
git add src/lib/server/library.json
git commit -m "Add two puzzles"
git push
```

On the instance:

```sh
cd ~/actor-connect
git pull
npm ci                                        # only when dependencies changed
npm run build                                 # required: library.json is bundled
pm2 reload ecosystem.config.cjs --update-env  # note: the config, not the name
```

**Reload the config file, not the process name.** `pm2 reload actor-connect`
reuses the environment the process was *first started* with, so a changed
`ecosystem.config.cjs` — including `PUZZLE_SEED` — never reaches the app, and
the deploy silently does nothing. Passing the config plus `--update-env` is what
re-reads it.

Every puzzle in `library.json` is then written to the database on boot, because
the config sets `PUZZLE_SEED: 'merge'`. New puzzles appear, edited ones update
in place. Confirm in the logs:

```sh
pm2 logs actor-connect --lines 40 --nostream | grep seed
# [actor-connect] seed (mode=merge): wrote 3 puzzle(s) from library.json
```

One line is always logged, so this tells you which of the two things happened:

| Log line | Meaning |
| --- | --- |
| `seed (mode=merge): wrote N puzzle(s)` | Worked. |
| `seed (mode=empty): left the database alone…` | `PUZZLE_SEED` didn't reach the process — reload the config as above. |
| nothing at all | The app didn't restart, or you're running a build from before this was added. Check `pm2 status` and rerun `npm run build`. |

### If puzzles still aren't appearing

Work down this list — each step rules out one cause:

```sh
# 1. Did the seed file actually arrive?
node -e "console.log(require('./src/lib/server/library.json').map(p=>p.id))"

# 2. Is the build fresh? (library.json is imported, so a pull alone isn't enough)
ls -l build/server/*.js | head -3        # newer than your git pull?

# 3. Does the running process have the variable?
pm2 env 0 | grep -E 'PUZZLE_SEED|DATABASE_PATH'

# 4. Is it writing the database you're reading?
sqlite3 "$(pm2 env 0 | sed -n 's/^DATABASE_PATH: //p')" "select id from puzzles;"
```

If step 3 shows no `PUZZLE_SEED`, the reload didn't take the new config. When in
doubt, recreate the process outright — this always applies the config, at the
cost of a second or two of downtime:

```sh
pm2 delete actor-connect
pm2 start ecosystem.config.cjs
pm2 save
```

**Only puzzles travel this way.** `data/` and `.env` are gitignored, so the
TMDB cache and the key are untouched by a deploy.

### The one rule

Pick a single source of truth for puzzles. With `merge`, `library.json` is it —
which means a puzzle **deleted** on the instance comes back on the next reload,
and an edit made **on the instance** to a puzzle that also exists in the seed
is overwritten by the seed's version.

If you'd rather author directly on production instead (step 6), set
`PUZZLE_SEED: 'empty'` and treat the instance's database as canonical — then
back it up, because it's the only copy.

### Deleting a puzzle for real

Delete it locally, re-export, commit, deploy. Removing it from `library.json`
stops it being re-added, but `merge` doesn't delete anything, so also remove it
on the instance once:

```sh
# with PUZZLE_EDITOR=1 and Caddy auth, use the Delete button in /build; or:
sqlite3 ~/actor-connect/data/actor-connect.db "delete from puzzles where id='the-id';"
pm2 reload ecosystem.config.cjs --update-env
```

## 8. Backups

The database is the only stateful thing on the instance, and it holds every
puzzle authored in production plus the accumulated TMDB cache. Back it up with
SQLite's own command — copying the file while the app is writing can capture a
torn page:

```sh
sudo apt install -y sqlite3
sqlite3 ~/actor-connect/data/actor-connect.db \
  ".backup '/home/$USER/backups/actor-connect-$(date +%F).db'"
```

A daily `cron` line and an `aws s3 cp` is enough. If you author locally and
deploy the seed file, the puzzles are already in git and only the cache is at
risk — which costs nothing to lose but a few API calls.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| PM2 shows `errored`, logs mention `.env` | No `.env` in `~/actor-connect`, or unreadable. `--env-file` is a hard failure. |
| `502` from Caddy | App isn't listening. `pm2 status`, then `pm2 logs actor-connect`. |
| Certificate never issues | DNS not resolving to the instance yet, or port 80 closed in the security group. |
| Build killed with no error | Out of memory. Add the swap file from step 2. |
| `/build` returns 404 | Working as intended in production. See step 6. |
| Builder search says the key isn't set | `.env` reached the process but has no `TMDB_API_KEY=` value. |
| Puzzles vanished after a deploy | `DATABASE_PATH` moved, or `data/` was wiped. Check `pm2 env 0 \| grep DATABASE`. |
| New puzzles don't appear, and `grep seed` finds nothing | The app didn't restart, or the build predates the seed logging. `pm2 status`, then `npm run build`. |
| New puzzles don't appear, log says `mode=empty` | `pm2 reload actor-connect` was used, which keeps the old environment. Use `pm2 reload ecosystem.config.cjs --update-env`. |
