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

`/build`, `/api/search`, `/api/links` and `/api/puzzles` spend the TMDB key and
edit the puzzle set, so they return **404 in production** unless you set
`PUZZLE_EDITOR=1`. Two ways to live with that:

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

	@editor path /build* /api/search* /api/links* /api/puzzles*
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

## 7. Updating

```sh
cd ~/actor-connect
git pull
npm ci
npm run build
pm2 reload actor-connect
```

`data/` and `.env` are gitignored, so puzzles, the TMDB cache and the key all
survive a deploy untouched.

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
