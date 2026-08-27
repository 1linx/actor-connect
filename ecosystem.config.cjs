/**
 * PM2 process definition.
 *
 * Note the .cjs extension: package.json sets `"type": "module"`, so a file named
 * ecosystem.config.js is treated as an ES module, `module.exports` quietly goes
 * nowhere, and PM2 reads an empty config and reports no apps to start.
 */
const os = require('node:os');
const path = require('node:path');

// PM2 does not expand `~`, and the username differs between AMIs (ubuntu on
// Ubuntu, ec2-user on Amazon Linux), so resolve the home directory instead of
// hardcoding either.
const appDir = path.join(os.homedir(), 'actor-connect');

module.exports = {
	apps: [
		{
			name: 'actor-connect',
			script: './build/index.js',
			cwd: appDir,

			// Node loads .env itself rather than PM2 doing it, which keeps the TMDB
			// key out of `pm2 env`, `pm2 describe`, and the dump file `pm2 save`
			// writes to ~/.pm2/dump.pm2. Requires Node 20.6+; the path is relative
			// to `cwd` above.
			//
			// A missing .env is a hard startup failure, which is what you want —
			// use --env-file-if-exists (Node 22+) if you'd rather it booted anyway.
			//
			// Nothing is set in both places: secrets live only in .env, everything
			// below only here, so there's no precedence question to reason about.
			node_args: '--env-file=.env',

			// One process, deliberately — not cluster mode. SQLite in WAL mode would
			// tolerate several, but the in-flight request coalescing in
			// src/lib/server/cache.ts is per-process, so extra workers would each
			// make their own TMDB call for the same uncached film. A micro instance
			// has 1–2 vCPUs anyway, so there is nothing to gain here.
			exec_mode: 'fork',
			instances: 1,

			env: {
				NODE_ENV: 'production',
				PORT: 9091,

				// Loopback only: Caddy is the only thing that should be able to reach
				// the app, so the port isn't exposed even if the security group is
				// ever opened up by mistake.
				HOST: '127.0.0.1',

				// Public URL. Used for url.origin and the CSRF origin check on POSTs,
				// so it must match what the browser actually asked for — including
				// https, since Caddy terminates TLS.
				ORIGIN: 'https://movie-connect.r2d20.com',

				// Puzzles and the durable TMDB cache. Absolute, so it can't end up
				// somewhere unexpected if the process is ever started from a
				// different working directory. Gitignored, and the one thing here
				// worth backing up.
				DATABASE_PATH: path.join(appDir, 'data', 'actor-connect.db')

				// The puzzle builder and the endpoints that spend the TMDB key are
				// closed in production. Uncomment to open them — and put auth in
				// front of them in Caddy first. See DEPLOY.md.
				// PUZZLE_EDITOR: '1'
			},

			// 1 GB of RAM, shared with the OS. Little is held in process now that the
			// cache is on disk, so this should never fire; if it does, it restarts
			// rather than inviting the OOM killer.
			max_memory_restart: '400M',

			autorestart: true,
			// Back off instead of hammering restarts when it can't start at all —
			// a missing .env or an already-bound port would otherwise crash-loop hot.
			exp_backoff_restart_delay: 200,

			time: true,
			out_file: path.join(appDir, 'logs/out.log'),
			error_file: path.join(appDir, 'logs/error.log')
		}
	]
};
