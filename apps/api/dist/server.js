"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const pg_1 = require("pg");
const node_crypto_1 = __importDefault(require("node:crypto"));
const multer_1 = __importDefault(require("multer"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const app = (0, express_1.default)();
const port = Number(process.env.PORT || 4000);
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const uploadDir = process.env.UPLOAD_DIR || node_path_1.default.resolve(process.cwd(), 'storage');
node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
const upload = (0, multer_1.default)({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });
app.use((0, cors_1.default)({ origin: process.env.WEB_ORIGIN || 'http://localhost:3000' }));
app.use(express_1.default.json({ limit: '2mb' }));
app.use('/media', express_1.default.static(uploadDir));
function hashPassword(password) {
    const salt = node_crypto_1.default.randomBytes(16).toString('hex');
    const derived = node_crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, stored) {
    const [, salt, key] = stored.split('$');
    if (!salt || !key)
        return false;
    const derived = node_crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return node_crypto_1.default.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(key, 'hex'));
}
function b64(value) { return Buffer.from(value).toString('base64url'); }
function tokenFor(user) {
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }));
    const signature = node_crypto_1.default.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}
function decodeToken(token) {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature)
        return null;
    const expected = node_crypto_1.default.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (signature.length !== expected.length || !node_crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
        return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000))
        return null;
    return data;
}
function auth(req, res, next) {
    const value = req.headers.authorization;
    if (!value?.startsWith('Bearer '))
        return res.status(401).json({ error: 'Autenticação necessária' });
    const decoded = decodeToken(value.slice(7));
    if (!decoded)
        return res.status(401).json({ error: 'Sessão inválida ou expirada' });
    req.user = { id: decoded.sub, role: decoded.role };
    next();
}
function artistOnly(req, res, next) {
    if (!['ARTIST', 'ADMIN', 'OWNER'].includes(req.user?.role || ''))
        return res.status(403).json({ error: 'Acesso reservado a artistas' });
    next();
}
app.get('/api/health', async (_req, res) => { try {
    await pool.query('select 1');
    res.json({ ok: true, service: 'babulo-api' });
}
catch {
    res.status(503).json({ ok: false });
} });
app.post('/api/auth/register', async (req, res) => {
    const { email, phone, password, role = 'LISTENER', stageName } = req.body || {};
    if (!password || String(password).length < 8)
        return res.status(400).json({ error: 'A palavra-passe deve ter pelo menos 8 caracteres' });
    if (!email && !phone)
        return res.status(400).json({ error: 'Informe email ou telefone' });
    const safeRole = ['LISTENER', 'ARTIST'].includes(role) ? role : 'LISTENER';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const u = await client.query(`insert into users(email,phone,password_hash,role) values($1,$2,$3,$4) returning id,email,phone,role,created_at`, [email || null, phone || null, hashPassword(password), safeRole]);
        let artist = null;
        if (safeRole === 'ARTIST') {
            if (!stageName) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'stageName é obrigatório para contas de artista' });
            }
            artist = (await client.query(`insert into artists(user_id,stage_name) values($1,$2) returning id,stage_name`, [u.rows[0].id, stageName])).rows[0];
        }
        await client.query('COMMIT');
        res.status(201).json({ user: u.rows[0], artist, token: tokenFor(u.rows[0]) });
    }
    catch (e) {
        await client.query('ROLLBACK');
        res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'Email ou telefone já registado' : 'Não foi possível criar a conta' });
    }
    finally {
        client.release();
    }
});
app.post('/api/auth/login', async (req, res) => {
    const { email, phone, password } = req.body || {};
    if ((!email && !phone) || !password)
        return res.status(400).json({ error: 'Informe os dados de acesso' });
    const q = await pool.query(`select id,email,phone,password_hash,role,status from users where email=$1 or phone=$2 limit 1`, [email || null, phone || null]);
    const user = q.rows[0];
    if (!user || user.status !== 'ACTIVE' || !verifyPassword(password, user.password_hash))
        return res.status(401).json({ error: 'Credenciais inválidas' });
    delete user.password_hash;
    res.json({ user, token: tokenFor(user) });
});
app.get('/api/auth/me', auth, async (req, res) => {
    const q = await pool.query(`select id,email,phone,role,status,email_verified,phone_verified,created_at from users where id=$1`, [req.user.id]);
    if (!q.rows[0])
        return res.status(404).json({ error: 'Utilizador não encontrado' });
    const artist = (await pool.query(`select id,stage_name,legal_name,bio,country,city,photo_url,verification_status from artists where user_id=$1`, [req.user.id])).rows[0] || null;
    res.json({ user: q.rows[0], artist });
});
app.get('/api/genres', async (_req, res) => res.json({ genres: (await pool.query('select id,name from genres order by name')).rows }));
app.get('/api/artists/:id', async (req, res) => {
    const artist = (await pool.query(`select id,stage_name,legal_name,bio,country,city,photo_url,verification_status from artists where id=$1`, [req.params.id])).rows[0];
    if (!artist)
        return res.status(404).json({ error: 'Artista não encontrado' });
    const releases = (await pool.query(`select id,title,type,cover_url,release_date,status from releases where primary_artist_id=$1 order by created_at desc`, [req.params.id])).rows;
    res.json({ artist, releases });
});
app.get('/api/tracks', async (_req, res) => {
    try {
        const q = await pool.query(`select t.id,t.title,coalesce(a.stage_name,'Artista BaBuLo') artist,coalesce(g.name,'Música') genre,r.cover_url "coverUrl" from tracks t left join track_artists ta on ta.track_id=t.id and ta.role='PRIMARY' left join artists a on a.id=ta.artist_id left join genres g on g.id=t.genre_id left join releases r on r.id=t.primary_release_id where t.status='PUBLISHED' order by t.created_at desc limit 24`);
        res.json({ tracks: q.rows });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Não foi possível carregar o catálogo' });
    }
});
app.post('/api/releases', auth, artistOnly, async (req, res) => {
    const { title, type = 'SINGLE', genreId, language, country, releaseDate, preReleaseDate, coverUrl, description, upc, ean, labelName, phonographicCopyright, copyrightText } = req.body || {};
    if (!title)
        return res.status(400).json({ error: 'O título do lançamento é obrigatório' });
    const artist = (await pool.query('select id from artists where user_id=$1 limit 1', [req.user.id])).rows[0];
    if (!artist)
        return res.status(404).json({ error: 'Perfil de artista não encontrado' });
    if (!['SINGLE', 'EP', 'ALBUM', 'ALBUM_PRO'].includes(type))
        return res.status(400).json({ error: 'Tipo de lançamento inválido' });
    const q = await pool.query(`insert into releases(title,type,primary_artist_id,genre_id,language,country,release_date,pre_release_date,cover_url,description,upc,ean,label_name,phonographic_copyright,copyright_text) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`, [title, type, artist.id, genreId || null, language || null, country || null, releaseDate || null, preReleaseDate || null, coverUrl || null, description || null, upc || null, ean || null, labelName || null, phonographicCopyright || null, copyrightText || null]);
    res.status(201).json({ release: q.rows[0] });
});
app.get('/api/artists/me/releases', auth, artistOnly, async (req, res) => {
    const artist = (await pool.query('select id from artists where user_id=$1 limit 1', [req.user.id])).rows[0];
    if (!artist)
        return res.status(404).json({ error: 'Perfil de artista não encontrado' });
    const q = await pool.query('select id,title,type,cover_url,release_date,status,created_at from releases where primary_artist_id=$1 order by created_at desc', [artist.id]);
    res.json({ releases: q.rows });
});
app.post('/api/tracks', auth, artistOnly, async (req, res) => {
    const { title, releaseId, genreId, language, version, durationMs, isExplicit = false, isrc, originalReleaseDate, fileUrl, fileType = 'AUDIO' } = req.body || {};
    if (!title || !releaseId)
        return res.status(400).json({ error: 'Título e lançamento são obrigatórios' });
    const artist = (await pool.query('select id from artists where user_id=$1 limit 1', [req.user.id])).rows[0];
    const release = (await pool.query('select id from releases where id=$1 and primary_artist_id=$2', [releaseId, artist?.id])).rows[0];
    if (!release)
        return res.status(404).json({ error: 'Lançamento não encontrado' });
    const client = await pool.connect();
    try {
        await client.query('begin');
        const t = (await client.query(`insert into tracks(title,version,duration_ms,language,genre_id,is_explicit,isrc,original_release_date,primary_release_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [title, version || null, durationMs || null, language || null, genreId || null, Boolean(isExplicit), isrc || null, originalReleaseDate || null, releaseId])).rows[0];
        await client.query(`insert into track_artists(track_id,artist_id,role) values($1,$2,'PRIMARY')`, [t.id, artist.id]);
        if (fileUrl) {
            await client.query(`insert into track_files(track_id,storage_key,file_type,format,status) values($1,$2,$3,$4,'UPLOADED')`, [t.id, fileUrl, fileType, 'unknown']);
        }
        await client.query('commit');
        res.status(201).json({ track: t });
    }
    catch (e) {
        await client.query('rollback');
        console.error(e);
        res.status(500).json({ error: 'Não foi possível criar a música' });
    }
    finally {
        client.release();
    }
});
app.put('/api/artists/me', auth, artistOnly, async (req, res) => {
    const { stageName, legalName, bio, country, city, photoUrl } = req.body || {};
    const q = await pool.query(`update artists set stage_name=coalesce($1,stage_name),legal_name=$2,bio=$3,country=$4,city=$5,photo_url=$6 where user_id=$7 returning id,stage_name,legal_name,bio,country,city,photo_url,verification_status`, [stageName, legalName || null, bio || null, country || null, city || null, photoUrl || null, req.user.id]);
    if (!q.rows[0])
        return res.status(404).json({ error: 'Perfil de artista não encontrado' });
    res.json({ artist: q.rows[0] });
});
app.post('/api/uploads', auth, upload.single('file'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    const ext = node_path_1.default.extname(req.file.originalname).toLowerCase();
    const finalName = `${req.user.id}-${Date.now()}-${node_crypto_1.default.randomUUID()}${ext}`;
    const finalPath = node_path_1.default.join(uploadDir, finalName);
    node_fs_1.default.renameSync(req.file.path, finalPath);
    res.status(201).json({ file: { name: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype, storageKey: finalName, url: `/media/${finalName}` } });
});
app.listen(port, () => console.log(`BaBuLo API running on :${port}`));
