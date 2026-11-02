import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { schema } from './schema.js';
import { statuses, priorities, severities, roles, isStaff, isAdmin, validId, clean } from './domain.js';

for (const key of ['sessionSecret', 'setupKey']) {
 if (!config[key] || config[key].length < 32 || /CHANGE|REPLACE/.test(config[key])) throw new Error('Set a unique random ' + key + ' (32+ characters) in config.local.js.');
}
if (config.sessionSecret === config.setupKey) throw new Error('Use different session and setup secrets.');
const root = path.dirname(fileURLToPath(import.meta.url));
const uploads = path.join(root, 'uploads');
await mkdir(uploads, { recursive: true });
const db = mysql.createPool({ ...config.mysql, connectionLimit: 10, multipleStatements: false });
for (const sql of schema) await db.query(sql);
const MySQLStore = MySQLStoreFactory(session);
const store = new MySQLStore({ ...config.mysql, createDatabaseTable: true });
store.on('error', err => console.error('Session store:', err.message));
const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '128kb' }));
app.use(session({ name: 'solarisbugs.sid', secret: config.sessionSecret, store, resave: false, saveUninitialized: false,
 cookie: { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', maxAge: 7 * 86400000 } }));
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const rows = async (sql, params = []) => (await db.execute(sql, params))[0];
const token = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
app.get('/health', async (req, res) => { try { await db.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api', async (req, res, next) => {
 if (req.session.userId) req.user = (await rows('SELECT id,name,email,role,active FROM users WHERE id=?', [req.session.userId]))[0];
 if (req.user && !req.user.active) { req.user = null; delete req.session.userId; }
 req.session.csrf ||= token();
 if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !equal(req.headers['x-csrf-token'], req.session.csrf)) return res.status(403).json({ error: 'Session expired. Reload the page.' });
 next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please sign in.' });
const staff = (req, res, next) => isStaff(req.user) ? next() : res.status(403).json({ error: 'Staff access required.' });
const admin = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ error: 'Administrator access required.' });
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false });
const account = body => {
 const name = clean(body.name, 80, true), email = clean(body.email, 190, true).toLowerCase();
 const password = clean(body.password, 72, true);
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password) > 72) fail(400, 'Use a valid email and a password of 12–72 bytes.');
 return { name, email, password };
};
const signIn = (req, id) => new Promise((resolve, reject) => req.session.regenerate(err => {
 if (err) return reject(err);
 req.session.userId = id; req.session.csrf = token();
 req.session.save(err => err ? reject(err) : resolve());
}));
app.get('/api/session', async (req, res) => res.json({ user: req.user || null, csrf: req.session.csrf,
 setupRequired: !(await rows('SELECT id FROM installation WHERE id=1')).length,
 registration: config.allowRegistration, siteName: config.siteName, statuses, priorities, severities }));
app.post('/api/setup', authLimit, async (req, res) => {
 if (!equal(req.body.setupKey, config.setupKey)) fail(403, 'Invalid setup key.');
 const a = account(req.body), hash = await bcrypt.hash(a.password, 12);
 const conn = await db.getConnection();
 let id;
 try {
  await conn.beginTransaction();
  await conn.execute('INSERT INTO installation (id) VALUES (1)');
  const [result] = await conn.execute("INSERT INTO users(name,email,password,role) VALUES (?,?,?,'owner')", [a.name, a.email, hash]);
  id = result.insertId; await conn.commit();
 } catch (err) { await conn.rollback(); if (err.code === 'ER_DUP_ENTRY') fail(409, 'Setup is already complete or email is in use.'); throw err; }
 finally { conn.release(); }
 await signIn(req, id); res.json({ ok: true });
});
app.post('/api/register', authLimit, async (req, res) => {
 if (!config.allowRegistration || !(await rows('SELECT id FROM installation WHERE id=1')).length) fail(403, 'Registration unavailable.');
 const a = account(req.body);
 const result = await rows('INSERT INTO users(name,email,password) VALUES (?,?,?)', [a.name, a.email, await bcrypt.hash(a.password, 12)]);
 await signIn(req, result.insertId); res.status(201).json({ ok: true });
});
app.post('/api/login', authLimit, async (req, res) => {
 const email = clean(req.body.email, 190, true).toLowerCase(), password = clean(req.body.password, 72, true);
 const user = (await rows('SELECT * FROM users WHERE email=?', [email]))[0];
 const hash = user?.password || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
 if (!await bcrypt.compare(password, hash) || !user?.active) fail(401, 'Invalid email or password.');
 await signIn(req, user.id); res.json({ ok: true });
});
app.post('/api/logout', (req, res, next) => req.session.destroy(err => { if (err) return next(err); res.clearCookie('solarisbugs.sid'); res.json({ ok: true }); }));
app.use('/api', auth);
app.get('/api/projects', async (req, res) => res.json(await rows('SELECT * FROM projects ORDER BY archived,name')));
app.post('/api/projects', admin, async (req, res) => {
 await rows('INSERT INTO projects(name,description) VALUES (?,?)', [clean(req.body.name, 100, true), clean(req.body.description || '', 5000)]);
 res.status(201).json({ ok: true });
});
app.patch('/api/projects/:id', admin, async (req, res) => {
 if (!validId(req.params.id)) fail(400, 'Invalid project.');
 const result = await rows('UPDATE projects SET name=?,description=?,archived=? WHERE id=?', [clean(req.body.name, 100, true), clean(req.body.description || '', 5000), !!req.body.archived, req.params.id]);
 if (!result.affectedRows) fail(404, 'Project not found.'); res.json({ ok: true });
});
app.get('/api/team', staff, async (req, res) => res.json(await rows("SELECT id,name,role FROM users WHERE active=1 AND role IN ('developer','admin','owner') ORDER BY name")));
app.get('/api/users', admin, async (req, res) => res.json(await rows('SELECT id,name,email,role,active,created_at FROM users ORDER BY name LIMIT 1000')));
app.patch('/api/users/:id', admin, async (req, res) => {
 const id = Number(req.params.id), { role, active } = req.body;
 if (!validId(req.params.id) || !roles.includes(role) || typeof active !== 'boolean') fail(400, 'Invalid user settings.');
 if (id === req.user.id) fail(400, 'You cannot change your own access.');
 const conn = await db.getConnection();
 try {
  await conn.beginTransaction();
  const [found] = await conn.execute('SELECT role FROM users WHERE id=? FOR UPDATE', [id]);
  if (!found.length) fail(404, 'User not found.');
  if (found[0].role === 'owner' || role === 'owner') fail(403, 'Owner access cannot be changed here.');
  if (req.user.role !== 'owner' && (found[0].role === 'admin' || role === 'admin')) fail(403, 'Only the owner manages administrators.');
  await conn.execute('UPDATE users SET role=?,active=? WHERE id=?', [role, active, id]);
  await conn.commit();
 } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
 res.json({ ok: true });
});
app.post('/api/account/password', async (req, res) => {
 const current = clean(req.body.current, 72, true), password = clean(req.body.password, 72, true);
 if (password.length < 12 || Buffer.byteLength(password) > 72) fail(400, 'Use a password of 12–72 bytes.');
 const user = (await rows('SELECT password FROM users WHERE id=?', [req.user.id]))[0];
 if (!await bcrypt.compare(current, user.password)) fail(403, 'Current password is incorrect.');
 await rows('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(password, 12), req.user.id]);
 await signIn(req, req.user.id); res.json({ ok: true });
});
const accessBug = async (req, res, next) => {
 if (!validId(req.params.id)) fail(404, 'Bug not found.');
 const bug = (await rows('SELECT * FROM bugs WHERE id=?', [req.params.id]))[0];
 if (!bug || (!isStaff(req.user) && bug.reporter_id !== req.user.id)) fail(404, 'Bug not found.');
 req.bug = bug; next();
};
app.get('/api/bugs', async (req, res) => {
 const where = [], params = [];
 if (!isStaff(req.user)) { where.push('b.reporter_id=?'); params.push(req.user.id); }
 for (const [key, col, allowed] of [['status','status',statuses], ['priority','priority',priorities], ['project','project_id',null]]) {
  if (req.query[key]) { if (allowed ? !allowed.includes(req.query[key]) : !validId(req.query[key])) fail(400, 'Invalid filter.'); where.push('b.' + col + '=?'); params.push(req.query[key]); }
 }
 if (req.query.mine === '1') { where.push('b.assignee_id=?'); params.push(req.user.id); }
 if (req.query.q) { const q = clean(req.query.q, 180); where.push('(b.title LIKE ? OR b.description LIKE ? OR CAST(b.id AS CHAR)=?)'); params.push('%' + q + '%', '%' + q + '%', q.replace(/^#/, '')); }
 const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
 const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
 const total = (await rows('SELECT COUNT(*) AS n FROM bugs b' + clause, params))[0].n;
 const items = await rows('SELECT b.*,p.name AS project_name,u.name AS reporter_name,a.name AS assignee_name FROM bugs b JOIN projects p ON p.id=b.project_id JOIN users u ON u.id=b.reporter_id LEFT JOIN users a ON a.id=b.assignee_id' + clause + ' ORDER BY b.updated_at DESC,b.id DESC LIMIT 30 OFFSET ' + ((page - 1) * 30), params);
 res.json({ items, total, page, pages: Math.ceil(total / 30) });
});
app.get('/api/stats', async (req, res) => {
 const where = isStaff(req.user) ? '' : ' WHERE reporter_id=?', p = isStaff(req.user) ? [] : [req.user.id];
 res.json(await rows('SELECT status,priority,COUNT(*) AS count FROM bugs' + where + ' GROUP BY status,priority', p));
});
app.post('/api/bugs', async (req, res) => {
 const b = req.body;
 if (!validId(b.project_id) || !priorities.includes(b.priority) || !severities.includes(b.severity)) fail(400, 'Invalid project, priority or severity.');
 if (!(await rows('SELECT id FROM projects WHERE id=? AND archived=0', [b.project_id])).length) fail(400, 'Choose an active project.');
 const values = [b.project_id, req.user.id, clean(b.title, 180, true), clean(b.description, 20000, true), clean(b.steps || '', 10000), clean(b.expected || '', 10000), clean(b.actual || '', 10000), clean(b.environment || '', 500), clean(b.version || '', 100), b.priority, b.severity];
 const result = await rows('INSERT INTO bugs(project_id,reporter_id,title,description,steps,expected,actual,environment,version,priority,severity) VALUES (?,?,?,?,?,?,?,?,?,?,?)', values);
 res.status(201).json({ id: result.insertId });
});
app.get('/api/bugs/:id', accessBug, async (req, res) => {
 const id = req.bug.id;
 const bug = (await rows('SELECT b.*,p.name AS project_name,u.name AS reporter_name,a.name AS assignee_name FROM bugs b JOIN projects p ON p.id=b.project_id JOIN users u ON u.id=b.reporter_id LEFT JOIN users a ON a.id=b.assignee_id WHERE b.id=?', [id]))[0];
 const comments = await rows('SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.bug_id=?' + (isStaff(req.user) ? '' : ' AND c.internal=0') + ' ORDER BY c.id', [id]);
 const attachments = await rows('SELECT id,filename,size,created_at FROM attachments WHERE bug_id=? ORDER BY id', [id]);
 const activity = await rows('SELECT a.*,u.name FROM activity a JOIN users u ON u.id=a.user_id WHERE a.bug_id=? ORDER BY a.id DESC LIMIT 200', [id]);
 res.json({ bug, comments, attachments, activity });
});
app.patch('/api/bugs/:id', staff, accessBug, async (req, res) => {
 const b = req.body;
 if (!statuses.includes(b.status) || !priorities.includes(b.priority) || !severities.includes(b.severity)) fail(400, 'Invalid workflow values.');
 const assignee = b.assignee_id ? Number(b.assignee_id) : null;
 if (assignee && (!validId(assignee) || !(await rows("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('developer','admin','owner')", [assignee])).length)) fail(400, 'Invalid assignee.');
 const resolution = clean(b.resolution || '', 10000);
 if (['resolved','closed'].includes(b.status) && !resolution) fail(400, 'Add a resolution before resolving or closing.');
 const conn = await db.getConnection();
 try {
  await conn.beginTransaction();
  const [current] = await conn.execute('SELECT * FROM bugs WHERE id=? FOR UPDATE', [req.bug.id]);
  const changes = [];
  for (const [k,v] of Object.entries({ status: b.status, priority: b.priority, severity: b.severity, assignee_id: assignee, resolution })) if ((current[0][k] ?? '') !== (v ?? '')) changes.push(k === 'resolution' ? 'Resolution updated' : k + ': ' + (current[0][k] ?? 'unassigned') + ' → ' + (v ?? 'unassigned'));
  await conn.execute('UPDATE bugs SET status=?,priority=?,severity=?,assignee_id=?,resolution=? WHERE id=?', [b.status,b.priority,b.severity,assignee,resolution,req.bug.id]);
  if (changes.length) await conn.execute('INSERT INTO activity(bug_id,user_id,body) VALUES (?,?,?)', [req.bug.id,req.user.id,changes.join('; ')]);
  await conn.commit();
 } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
 res.json({ ok: true });
});
app.post('/api/bugs/:id/comments', accessBug, async (req, res) => {
 const internal = !!req.body.internal;
 if (internal && !isStaff(req.user)) fail(403, 'Staff notes require staff access.');
 await rows('INSERT INTO comments(bug_id,user_id,body,internal) VALUES (?,?,?,?)', [req.bug.id,req.user.id,clean(req.body.body,10000,true),internal]);
 await rows('UPDATE bugs SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [req.bug.id]); res.status(201).json({ ok: true });
});
const upload = multer({ storage: multer.diskStorage({ destination: uploads, filename: (req,file,cb) => cb(null, token()) }),
 limits: { fileSize: config.uploadLimitMB * 1024 * 1024, files: 1 },
 fileFilter: (req,file,cb) => {
  if (!/\.(png|jpe?g|gif|webp|txt|log|pdf|zip)$/i.test(file.originalname)) return cb(Object.assign(new Error('Allowed: images, TXT, LOG, PDF and ZIP.'), { status: 400 }));
  cb(null,true);
 } });
app.post('/api/bugs/:id/attachments', accessBug, upload.single('file'), async (req, res) => {
 if (!req.file) fail(400, 'Choose a file.');
 try { await rows('INSERT INTO attachments(bug_id,user_id,filename,storage_name,size) VALUES (?,?,?,?,?)', [req.bug.id,req.user.id,path.basename(req.file.originalname).slice(0,255),req.file.filename,req.file.size]); }
 catch(err) { await unlink(req.file.path).catch(() => {}); throw err; }
 res.status(201).json({ ok: true });
});
app.get('/api/attachments/:id', async (req, res) => {
 if (!validId(req.params.id)) fail(404, 'File not found.');
 const file = (await rows('SELECT a.*,b.reporter_id FROM attachments a JOIN bugs b ON b.id=a.bug_id WHERE a.id=?', [req.params.id]))[0];
 if (!file || (!isStaff(req.user) && file.reporter_id !== req.user.id)) fail(404, 'File not found.');
 res.set('Content-Type', 'application/octet-stream'); res.download(path.join(uploads,file.storage_name),file.filename);
});
app.use('/api', (req,res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use(express.static(path.join(root,'public')));
app.use((err,req,res,next) => {
 if (res.headersSent) return next(err);
 const status = err.code === 'ER_DUP_ENTRY' ? 409 : err.code === 'LIMIT_FILE_SIZE' ? 413 : err instanceof multer.MulterError ? 400 : err.status || 500;
 if (status >= 500) console.error(err);
 res.status(status).json({ error: status === 409 ? 'That record already exists.' : status === 413 ? 'File is too large.' : status >= 500 ? 'An unexpected error occurred.' : err.message });
});
const server = app.listen(config.port,config.host,() => console.log(config.siteName + ' listening on ' + config.host + ':' + config.port));
const shutdown = () => server.close(async () => { await db.end(); store.close(); process.exit(0); });
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
