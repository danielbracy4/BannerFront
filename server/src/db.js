'use strict';
// The ledger: accounts, sessions and match records, in SQLite.
//
// Node's built-in `node:sqlite` (22.5+), so there is no native dependency to
// compile and nothing new in package.json. The file lives under DATA_DIR —
// locally that is ./data (gitignored); on Railway attach a volume and set
// DATA_DIR to its mount point, or every deploy starts the ledger blank.
//
// Passwords are scrypt-hashed with a per-account salt and compared in constant
// time. The server never stores or logs the password itself. Sessions are
// opaque random tokens with a 30-day life, held by the client and passed back
// on connect — there are no cookies, so there is nothing to CSRF.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Where the ledger lives, in order of preference:
//   1. DATA_DIR — an explicit choice always wins.
//   2. RAILWAY_VOLUME_MOUNT_PATH — Railway injects this on its own the moment a
//      volume is attached to the service. Reading it means attaching the volume
//      is the *whole* deployment step: there is no second variable to go and
//      set, and therefore no way to attach storage and still be writing to a
//      disk that vanishes on the next deploy.
//   3. ./data, for running locally (gitignored).
const DATA_DIR = process.env.DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.resolve(__dirname, '../../data');
const SESSION_DAYS = 30;

let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'bannerfront.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      hash       TEXT NOT NULL,
      salt       TEXT NOT NULL,
      created    INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      played     INTEGER NOT NULL DEFAULT 0,
      wins       INTEGER NOT NULL DEFAULT 0,
      best_share REAL    NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token   TEXT PRIMARY KEY,
      account INTEGER NOT NULL REFERENCES accounts(id),
      expires INTEGER NOT NULL
    );
  `);
  // Migrations, additive and idempotent. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so ask the table what it already has — a ledger with players in it
  // must survive a deploy that adds a sign-in provider.
  const cols = new Set(db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name));
  const add = (name, decl) => { if (!cols.has(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${decl}`); };
  add('email',      'TEXT');
  add('google_sub', 'TEXT');   // Google's stable subject id, never an email
  add('steam_id',   'TEXT');   // SteamID64
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_google ON accounts(google_sub) WHERE google_sub IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_steam  ON accounts(steam_id)   WHERE steam_id   IS NOT NULL;
    CREATE INDEX        IF NOT EXISTS idx_email  ON accounts(email)      WHERE email      IS NOT NULL;
  `);
} catch (e) {
  console.log('  ledger disabled: ' + e.message + ' (accounts need node 22.5+)');
}

const now = () => Date.now();
const hashPass = (pass, salt) =>
  crypto.scryptSync(String(pass), Buffer.from(salt, 'hex'), 64).toString('hex');

// Names follow the same rules as house names in the lobby, minus markup.
const NAME_RE = /^[\p{L}\p{N}' \-]{3,18}$/u;

function publicRow(a){
  return { name: a.name, played: a.played, wins: a.wins,
           bestShare: Math.round(a.best_share * 1000) / 10, since: a.created,
           via: a.google_sub ? 'google' : a.steam_id ? 'steam' : 'password' };
}

// A house name has to be unique, and a Google or Steam display name is whatever
// the player happens to be called there — so make it fit the same rules as a
// typed one, then walk a number up until it is free.
function freeName(want){
  let base = String(want || '').replace(/[^\p{L}\p{N}' \-]/gu, '').trim().slice(0, 18) || 'A Lord';
  while (base.length < 3) base += 'x';
  const taken = n => !!db.prepare('SELECT id FROM accounts WHERE name = ?').get(n);
  if (!taken(base)) return base;
  for (let i = 2; i < 9999; i++){
    const n = base.slice(0, 18 - String(i).length - 1) + ' ' + i;
    if (!taken(n)) return n;
  }
  return base + crypto.randomBytes(3).toString('hex');
}

// Password login must be impossible on an account that never had a password.
// Storing a random hash nobody knows the input to is how that is done — the
// column stays NOT NULL, and there is no value a player could type that hashes
// to it. Leaving the field blank instead would be a way in.
const unusablePass = () => ({ hash: crypto.randomBytes(64).toString('hex'),
                              salt: crypto.randomBytes(16).toString('hex') });

function newSession(accountId){
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now());
  db.prepare('INSERT INTO sessions (token, account, expires) VALUES (?,?,?)')
    .run(token, accountId, now() + SESSION_DAYS * 86400e3);
  db.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').run(now(), accountId);
  return token;
}

module.exports = {
  get enabled(){ return !!db; },
  // Surfaced on /healthz so it is possible to tell, from outside, whether the
  // ledger is on durable storage or on a disk the next deploy will throw away.
  get where(){ return db ? DATA_DIR : null; },
  get onVolume(){ return !!db && !!process.env.RAILWAY_VOLUME_MOUNT_PATH; },

  signup(name, pass){
    if (!db) return { err: 'the ledger is closed on this server' };
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) return { err: 'a name is 3–18 letters, numbers, spaces or hyphens' };
    if (String(pass || '').length < 8) return { err: 'a password needs at least 8 characters' };
    if (db.prepare('SELECT id FROM accounts WHERE name = ?').get(name))
      return { err: 'that house is already sworn — choose another name' };
    const salt = crypto.randomBytes(16).toString('hex');
    const t = now();
    db.prepare('INSERT INTO accounts (name, hash, salt, created, last_seen) VALUES (?,?,?,?,?)')
      .run(name, hashPass(pass, salt), salt, t, t);
    return this.login(name, pass);
  },

  login(name, pass){
    if (!db) return { err: 'the ledger is closed on this server' };
    const a = db.prepare('SELECT * FROM accounts WHERE name = ?').get(String(name || '').trim());
    // Hash against a dummy salt when the account is missing, so a wrong name
    // and a wrong password take the same time to refuse.
    const salt = a ? a.salt : '00'.repeat(16);
    const tryHash = Buffer.from(hashPass(pass, salt), 'hex');
    const goodHash = Buffer.from(a ? a.hash : '00'.repeat(64), 'hex');
    if (!a || !crypto.timingSafeEqual(tryHash, goodHash))
      return { err: 'no such house, or the word is wrong' };
    return { token: newSession(a.id), account: publicRow(a) };
  },

  logout(token){
    if (db && token) db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
    return {};
  },

  // A player who founded a house can dissolve it. The password is asked for
  // again on purpose: a token left behind on a shared machine should not be
  // enough to destroy the account it belongs to.
  remove(token, pass){
    if (!db) return { err: 'the ledger is closed on this server' };
    const s = token && db.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token));
    if (!s || s.expires < now()) return { err: 'not signed in' };
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(s.account);
    if (!a) return { err: 'no such house' };
    const tryHash = Buffer.from(hashPass(pass, a.salt), 'hex');
    if (!crypto.timingSafeEqual(tryHash, Buffer.from(a.hash, 'hex')))
      return { err: 'the word is wrong' };
    db.prepare('DELETE FROM sessions WHERE account = ?').run(a.id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(a.id);
    return { gone: a.name };
  },

  // Sign in through Google or Steam. `key` is the column holding that
  // provider's id, `id` the value it gave us.
  //
  // Matching is on the provider id and NOTHING else — deliberately.
  //
  // The tempting second key is the email, so that someone who founded a house
  // with a password and later clicks "sign in with Google" lands back in their
  // own account instead of an empty one. That is only safe if the password
  // account's email was *verified*, and this server sends no verification mail.
  // Adopting an account by an unverified address is an account takeover: found
  // a house claiming somebody else's gmail, wait for them to sign in with
  // Google, and the server hands you their record — with your password still on
  // it. So Google accounts and password accounts stay separate.
  //
  // The email Google gives us *is* verified, and is stored, so if verification
  // is added later this can be turned on safely for addresses proved on both
  // sides. Steam supplies no email at all and can never match on one.
  viaProvider(key, id, { email, name }){
    if (!db) return { err: 'the ledger is closed on this server' };
    if (!id) return { err: 'that sign-in returned nobody' };
    id = String(id);

    let a = db.prepare(`SELECT * FROM accounts WHERE ${key} = ?`).get(id);

    if (!a){
      const p = unusablePass(), t = now();
      const r = db.prepare(`INSERT INTO accounts (name, hash, salt, created, last_seen, email, ${key})
                            VALUES (?,?,?,?,?,?,?)`)
        .run(freeName(name), p.hash, p.salt, t, t, email || null, id);
      a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(r.lastInsertRowid);
    } else if (email && !a.email){
      db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(email, a.id);
    }

    return { token: newSession(a.id), account: publicRow(a) };
  },

  // token -> account row, or null. The id rides along for match recording.
  resolve(token){
    if (!db || !token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token));
    if (!s || s.expires < now()) return null;
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(s.account);
    return a ? { id: a.id, ...publicRow(a) } : null;
  },

  // Only the authoritative server calls this, and only for online matches — a
  // solo result is the client's word, and the client's word is not a record.
  recordMatch(accountId, { won, share }){
    if (!db || accountId == null) return;
    db.prepare(`UPDATE accounts SET played = played + 1, wins = wins + ?,
                best_share = MAX(best_share, ?), last_seen = ? WHERE id = ?`)
      .run(won ? 1 : 0, +share || 0, now(), accountId);
  },

  leaderboard(){
    if (!db) return [];
    return db.prepare(`SELECT * FROM accounts WHERE played > 0
                       ORDER BY wins DESC, best_share DESC LIMIT 20`)
      .all().map(publicRow);
  },
};
