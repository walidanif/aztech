'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = path.resolve(process.env.AZ_DATA_DIR || path.join(ROOT, 'data'));
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SEED_FILE = path.join(ROOT, 'data', 'products.json');
const PRODUCT_IMAGES_DIR = path.join(DATA_DIR, 'product-images');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const CATEGORIES = new Set(['telephones', 'laptops', 'accessoires', 'televiseurs', 'electromenagers']);
const PERMISSIONS = new Set(['products.view', 'products.manage']);
const sessions = new Map();
const loginAttempts = new Map();
const catalogClients = new Set();
let store;
let saveQueue = Promise.resolve();

function supabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project environment variables.');
    return { url: url.replace(/\/+$/, ''), key };
}

async function supabaseRequest(resource, options = {}) {
    const { url, key } = supabaseConfig();
    const response = await fetch(`${url}/rest/v1/${resource}`, {
        ...options,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function createSupabaseImageUpload(filename) {
    const { url, key } = supabaseConfig();
    const response = await fetch(`${url}/storage/v1/object/upload/sign/product-images/${filename}`, {
        method: 'POST',
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: '{}'
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Could not create a signed image upload (${response.status}): ${detail.slice(0, 300)}`);
    }
    const result = await response.json();
    const signedPath = result.url || result.signedURL;
    if (!signedPath) throw new Error('Supabase did not return a signed image upload URL.');
    const uploadUrl = /^https?:\/\//i.test(signedPath)
        ? signedPath
        : `${url}/storage/v1${signedPath.startsWith('/') ? signedPath : `/${signedPath}`}`;
    return { uploadUrl, img: `uploads/${filename}` };
}

function normalizedUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions,
        isActive: user.isActive,
        forcePasswordChange: Boolean(user.forcePasswordChange),
        createdAt: user.createdAt
    };
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const derivedKey = await scrypt(password, salt, 64);
    return { salt, passwordHash: derivedKey.toString('hex') };
}

async function verifyPassword(password, user) {
    const derivedKey = await scrypt(password, user.salt, 64);
    const expected = Buffer.from(user.passwordHash, 'hex');
    return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey);
}

function hasPermission(user, permission) {
    if (!user || !user.isActive) return false;
    return user.role === 'admin' || user.permissions.includes(permission);
}

function writeStore() {
    saveQueue = saveQueue.then(async () => {
        if (IS_VERCEL) {
            await supabaseRequest('az_store?on_conflict=id', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ id: 1, data: store, updated_at: new Date().toISOString() })
            });
            return;
        }
        const tempFile = STORE_FILE + '.tmp';
        await fs.writeFile(tempFile, JSON.stringify(store, null, 2), { mode: 0o600 });
        await fs.rename(tempFile, STORE_FILE);
    });
    return saveQueue;
}

async function initializeStore() {
    if (IS_VERCEL) {
        const rows = await supabaseRequest('az_store?id=eq.1&select=data');
        if (rows.length) {
            store = rows[0].data;
            if (!Array.isArray(store.products) || !Array.isArray(store.users) || !Array.isArray(store.audit)) {
                throw new Error('The Supabase az_store row has an invalid format.');
            }
            if (store.users.length === 0) await bootstrapAdmin();
            return;
        }
        store = { products: JSON.parse(await fs.readFile(SEED_FILE, 'utf8')), users: [], audit: [] };
        await bootstrapAdmin();
        return;
    }

    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
        store = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
        if (!Array.isArray(store.products) || !Array.isArray(store.users) || !Array.isArray(store.audit)) {
            throw new Error('The existing data/store.json file has an invalid format.');
        }
        if (store.users.length === 0) await bootstrapAdmin();
        return;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const products = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
    store = { products, users: [], audit: [] };
    await bootstrapAdmin();
}

async function bootstrapAdmin() {
    const username = 'admin';
    const password = IS_VERCEL ? process.env.ADMIN_INITIAL_PASSWORD : 'admin';
    if (!password) throw new Error('Set ADMIN_INITIAL_PASSWORD in Vercel before the first deployment.');
    if (IS_VERCEL) validatePassword(password);
    const credentials = await hashPassword(password);
    store.users.push({
        id: crypto.randomUUID(),
        username,
        ...credentials,
        role: 'admin',
        permissions: [...PERMISSIONS],
        isActive: true,
        forcePasswordChange: true,
        createdAt: new Date().toISOString()
    });
    await writeStore();
    console.warn(IS_VERCEL
        ? 'Created the initial Vercel administrator. Change the temporary password after signing in.'
        : 'Created temporary administrator admin/admin. Keep this server private until the password is changed.');
}

function validateUsername(username) {
    if (username.length < 3 || username.length > 40 || !/^[a-z0-9._-]+$/.test(username)) {
        throw httpError(400, 'Username must be 3-40 characters using letters, numbers, dot, dash, or underscore.');
    }
}

function validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 200) {
        throw httpError(400, `Password must be between ${PASSWORD_MIN_LENGTH} and 200 characters.`);
    }
}

function validateProduct(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Invalid product data.');
    const title = String(input.title || '').trim();
    const brand = String(input.brand || '').trim();
    const category = String(input.category || '');
    const description = String(input.description || '').trim();
    const img = String(input.img || '').trim();
    const price = Number(input.price);
    const oldPrice = input.oldPrice === '' || input.oldPrice == null ? 0 : Number(input.oldPrice);

    if (!title || title.length > 160) throw httpError(400, 'Product title is required (maximum 160 characters).');
    if (!brand || brand.length > 100) throw httpError(400, 'Brand is required (maximum 100 characters).');
    if (!CATEGORIES.has(category)) throw httpError(400, 'Choose a valid product category.');
    if (!Number.isFinite(price) || price < 0 || price > 100000000) throw httpError(400, 'Enter a valid current price.');
    if (!Number.isFinite(oldPrice) || oldPrice < 0 || oldPrice > 100000000) throw httpError(400, 'Enter a valid original price.');
    if (oldPrice > 0 && price > oldPrice) throw httpError(400, 'Current price cannot exceed the original price.');
    if (description.length > 2000) throw httpError(400, 'Description cannot exceed 2000 characters.');
    if (!img || img.length > 2000) throw httpError(400, 'Provide a product image path or HTTPS URL.');
    if (/^https?:\/\//i.test(img)) {
        if (!/^https:\/\//i.test(img)) throw httpError(400, 'External product images must use HTTPS.');
    } else if (!/^assets\/products\/[a-zA-Z0-9._/-]+$/.test(img) || img.includes('..')) {
        if (!/^uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i.test(img)) {
            throw httpError(400, 'Choose a valid product image.');
        }
    }

    const discount = oldPrice > price && oldPrice > 0
        ? Math.round((1 - price / oldPrice) * 100)
        : 0;
    return { title, brand, category, oldPrice, price, discount, description, img };
}

function validatePermissions(input) {
    if (!Array.isArray(input)) throw httpError(400, 'Choose the user permissions.');
    return [...new Set(input)].filter(permission => {
        if (!PERMISSIONS.has(permission)) throw httpError(400, 'Unknown permission.');
        return true;
    });
}

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
}

function publishCatalogUpdate() {
    for (const client of catalogClients) client.write('event: catalog-updated\ndata: {}\n\n');
}

async function readJson(req, maxBytes = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) throw httpError(413, 'Request body is too large.');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
        throw httpError(400, 'Request body must be valid JSON.');
    }
}

function setSessionCookie(res, token, maxAge = Math.floor(SESSION_TTL_MS / 1000)) {
    const secure = IS_VERCEL || process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `az_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure}`
    );
}

function detectImageExtension(buffer) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return '.gif';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
    return null;
}

function decodeImageData(data) {
    if (!data || typeof data.dataUrl !== 'string') throw httpError(400, 'Choose an image to upload.');
    const match = data.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw httpError(400, 'Use a PNG, JPEG, WebP, or GIF image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
        throw httpError(413, 'Images must be smaller than 5 MB.');
    }
    if (bytes.toString('base64') !== match[2]) throw httpError(400, 'The uploaded image is invalid.');
    const extension = detectImageExtension(bytes);
    const expectedType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extension];
    if (!extension || expectedType !== match[1]) throw httpError(400, 'The image contents do not match the selected file type.');
    return { bytes, extension };
}

function sessionToken(req) {
    const cookie = req.headers.cookie || '';
    return cookie.split(';').map(part => part.trim()).find(part => part.startsWith('az_session='))
        ?.slice('az_session='.length);
}

async function saveSession(token, userId, expiresAt) {
    const tokenHash = hashToken(token);
    if (IS_VERCEL) {
        await supabaseRequest('az_sessions', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ token_hash: tokenHash, user_id: userId, expires_at: new Date(expiresAt).toISOString() })
        });
        return;
    }
    sessions.set(tokenHash, { userId, expiresAt });
}

async function deleteSession(token) {
    if (!token) return;
    const tokenHash = hashToken(token);
    if (IS_VERCEL) {
        await supabaseRequest(`az_sessions?token_hash=eq.${tokenHash}`, { method: 'DELETE' });
        return;
    }
    sessions.delete(tokenHash);
}

async function requestUser(req) {
    const token = sessionToken(req);
    if (!token) return null;
    let session;
    if (IS_VERCEL) {
        const rows = await supabaseRequest(`az_sessions?token_hash=eq.${hashToken(token)}&select=user_id,expires_at`);
        if (!rows.length) return null;
        session = { userId: rows[0].user_id, expiresAt: Date.parse(rows[0].expires_at) };
    } else {
        session = sessions.get(hashToken(token));
    }
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        await deleteSession(token);
        return null;
    }
    const user = store.users.find(item => item.id === session.userId);
    if (!user || !user.isActive) {
        await deleteSession(token);
        return null;
    }
    return user;
}

function requireSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || !req.headers.host) throw httpError(403, 'Request origin could not be verified.');
    let originHost;
    try {
        originHost = new URL(origin).host;
    } catch {
        throw httpError(403, 'Request origin is invalid.');
    }
    if (originHost !== req.headers.host) throw httpError(403, 'Cross-origin requests are not allowed.');
}

function requireAdmin(user) {
    if (!user || user.role !== 'admin') throw httpError(403, 'Administrator access is required.');
}

function requirePermission(user, permission) {
    if (!hasPermission(user, permission)) throw httpError(403, 'Your account does not have permission for this action.');
}

function audit(actor, action, subject) {
    store.audit.push({ at: new Date().toISOString(), actor: actor.username, action, subject });
    if (store.audit.length > 500) store.audit.splice(0, store.audit.length - 500);
}

async function revokeUserSessions(userId) {
    if (IS_VERCEL) {
        await supabaseRequest(`az_sessions?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' });
        return;
    }
    for (const [tokenHash, session] of sessions) {
        if (session.userId === userId) sessions.delete(tokenHash);
    }
}

function parseUserId(value) {
    if (!/^[0-9a-f-]{36}$/i.test(value)) throw httpError(400, 'Invalid user ID.');
    return value;
}

async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/platform') {
        return sendJson(res, 200, { serverless: IS_VERCEL });
    }

    if (req.method === 'GET' && url.pathname === '/api/catalog-events') {
        if (IS_VERCEL) {
            res.writeHead(204, { 'Cache-Control': 'no-store' });
            return res.end();
        }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.write(': connected\n\n');
        catalogClients.add(res);
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);
        res.on('close', () => {
            clearInterval(keepAlive);
            catalogClients.delete(res);
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/products') {
        return sendJson(res, 200, store.products);
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
        requireSameOrigin(req);
        const data = await readJson(req);
        const username = normalizedUsername(data.username);
        const ip = req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const attempts = (loginAttempts.get(ip) || []).filter(time => now - time < 15 * 60 * 1000);
        if (attempts.length >= 10) throw httpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');

        const user = store.users.find(item => item.username === username);
        if (!user || !user.isActive || !await verifyPassword(String(data.password || ''), user)) {
            attempts.push(now);
            loginAttempts.set(ip, attempts);
            throw httpError(401, 'Invalid username or password.');
        }
        loginAttempts.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        await saveSession(token, user.id, now + SESSION_TTL_MS);
        setSessionCookie(res, token);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        return res.end(JSON.stringify({ user: publicUser(user) }));
    }

    if (url.pathname.startsWith('/api/admin/')) {
        const user = await requestUser(req);
        if (!user) throw httpError(401, 'Please sign in again.');
        if (req.method !== 'GET') requireSameOrigin(req);

        if (req.method === 'GET' && url.pathname === '/api/admin/session') {
            return sendJson(res, 200, { user: publicUser(user) });
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
            const token = (req.headers.cookie || '').split(';').map(part => part.trim())
                .find(part => part.startsWith('az_session='))?.slice('az_session='.length);
            await deleteSession(token);
            setSessionCookie(res, '', 0);
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            return res.end(JSON.stringify({ ok: true }));
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/change-password') {
            const data = await readJson(req);
            const currentPassword = String(data.currentPassword || '');
            const newPassword = String(data.newPassword || '');
            if (!await verifyPassword(currentPassword, user)) throw httpError(401, 'Current password is incorrect.');
            validatePassword(newPassword);
            if (currentPassword === newPassword) throw httpError(400, 'Choose a new password different from the current one.');
            Object.assign(user, await hashPassword(newPassword));
            user.forcePasswordChange = false;
            audit(user, 'password.change', user.username);
            await writeStore();
            const oldToken = (req.headers.cookie || '').split(';').map(part => part.trim())
                .find(part => part.startsWith('az_session='))?.slice('az_session='.length);
            await deleteSession(oldToken);
            const newToken = crypto.randomBytes(32).toString('hex');
            await saveSession(newToken, user.id, Date.now() + SESSION_TTL_MS);
            setSessionCookie(res, newToken);
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            return res.end(JSON.stringify({ user: publicUser(user) }));
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requireAdmin(user);
            return sendJson(res, 200, store.audit.slice(-100).reverse());
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/users') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requireAdmin(user);
            return sendJson(res, 200, store.users.map(publicUser));
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/users') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requireAdmin(user);
            const data = await readJson(req);
            const username = normalizedUsername(data.username);
            const password = String(data.password || '');
            const role = data.role;
            validateUsername(username);
            validatePassword(password);
            if (role !== 'admin' && role !== 'user') throw httpError(400, 'Choose admin or user as the account type.');
            if (store.users.some(item => item.username === username)) throw httpError(409, 'That username is already in use.');
            const credentials = await hashPassword(password);
            const created = {
                id: crypto.randomUUID(),
                username,
                ...credentials,
                role,
                permissions: role === 'admin' ? [...PERMISSIONS] : validatePermissions(data.permissions || []),
                isActive: true,
                createdAt: new Date().toISOString()
            };
            store.users.push(created);
            audit(user, 'user.create', created.username);
            await writeStore();
            return sendJson(res, 201, { user: publicUser(created) });
        }
        const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (req.method === 'PATCH' && userMatch) {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requireAdmin(user);
            const target = store.users.find(item => item.id === parseUserId(userMatch[1]));
            if (!target) throw httpError(404, 'User not found.');
            const data = await readJson(req);
            if (target.id === user.id && data.isActive === false) throw httpError(400, 'You cannot block your own account.');
            const nextRole = data.role === undefined ? target.role : data.role;
            if (nextRole !== 'admin' && nextRole !== 'user') throw httpError(400, 'Choose admin or user as the account type.');
            const nextActive = data.isActive === undefined ? target.isActive : Boolean(data.isActive);
            if (target.role === 'admin' && target.isActive && (nextRole !== 'admin' || !nextActive)) {
                const activeAdmins = store.users.filter(item => item.role === 'admin' && item.isActive);
                if (activeAdmins.length <= 1) throw httpError(400, 'The last active administrator cannot be blocked or demoted.');
            }
            target.role = nextRole;
            target.isActive = nextActive;
            target.permissions = target.role === 'admin'
                ? [...PERMISSIONS]
                : (data.permissions === undefined ? target.permissions : validatePermissions(data.permissions));
            if (data.password !== undefined && data.password !== '') {
                validatePassword(String(data.password));
                Object.assign(target, await hashPassword(String(data.password)));
            }
            audit(user, 'user.update', target.username);
            await writeStore();
            if (!target.isActive) await revokeUserSessions(target.id);
            return sendJson(res, 200, { user: publicUser(target) });
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/uploads/product-image') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requirePermission(user, 'products.manage');
            if (IS_VERCEL) {
                const data = await readJson(req);
                const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[data.contentType];
                if (!extension) throw httpError(400, 'Use a PNG, JPEG, WebP, or GIF image.');
                const filename = `${crypto.randomUUID()}${extension}`;
                return sendJson(res, 200, await createSupabaseImageUpload(filename));
            }
            const { bytes, extension } = decodeImageData(await readJson(req, 7 * 1024 * 1024));
            const filename = `${crypto.randomUUID()}${extension}`;
            await fs.mkdir(PRODUCT_IMAGES_DIR, { recursive: true });
            await fs.writeFile(path.join(PRODUCT_IMAGES_DIR, filename), bytes, { flag: 'wx', mode: 0o644 });
            audit(user, 'product.image.upload', filename);
            await writeStore();
            return sendJson(res, 201, { img: `uploads/${filename}` });
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/products') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requirePermission(user, 'products.manage');
            const product = validateProduct(await readJson(req));
            const nextId = Math.max(0, ...store.products.map(item => Number(item.id) || 0)) + 1;
            const created = { id: nextId, ...product };
            store.products.push(created);
            audit(user, 'product.create', String(created.id));
            await writeStore();
            publishCatalogUpdate();
            return sendJson(res, 201, { product: created });
        }
        const productMatch = url.pathname.match(/^\/api\/admin\/products\/(\d+)$/);
        if (productMatch && req.method === 'PUT') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requirePermission(user, 'products.manage');
            const product = validateProduct(await readJson(req));
            const index = store.products.findIndex(item => item.id === Number(productMatch[1]));
            if (index === -1) throw httpError(404, 'Product not found.');
            const updated = { id: store.products[index].id, ...product };
            store.products[index] = updated;
            audit(user, 'product.update', String(updated.id));
            await writeStore();
            publishCatalogUpdate();
            return sendJson(res, 200, { product: updated });
        }
        if (productMatch && req.method === 'DELETE') {
            if (user.forcePasswordChange) throw httpError(403, 'Change the temporary password before using the administration panel.');
            requirePermission(user, 'products.manage');
            const index = store.products.findIndex(item => item.id === Number(productMatch[1]));
            if (index === -1) throw httpError(404, 'Product not found.');
            const [removed] = store.products.splice(index, 1);
            audit(user, 'product.delete', String(removed.id));
            await writeStore();
            publishCatalogUpdate();
            return sendJson(res, 200, { ok: true });
        }
    }

    const uploadMatch = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]{36}\.(?:png|jpg|webp|gif))$/i);
    if (uploadMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        url.pathname = `/uploads/${uploadMatch[1]}`;
        return serveStatic(req, res, url);
    }

    throw httpError(404, 'API endpoint not found.');
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
};

async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed.');
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        throw httpError(400, 'Invalid URL path.');
    }
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
    if (pathname === '/') pathname = '/index.html';
    let filePath;
    if (pathname.startsWith('/uploads/')) {
        const filename = pathname.slice('/uploads/'.length);
        if (!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i.test(filename)) throw httpError(404, 'Not found.');
        if (IS_VERCEL) {
            const { url: supabaseUrl } = supabaseConfig();
            res.writeHead(302, {
                Location: `${supabaseUrl}/storage/v1/object/public/product-images/${filename}`,
                'Cache-Control': 'public, max-age=3600'
            });
            return res.end();
        }
        filePath = path.join(PRODUCT_IMAGES_DIR, filename);
    } else {
        const publicPage = new Set(['/index.html', '/admin.html', '/admin.js']);
        if (!publicPage.has(pathname) && !pathname.startsWith('/assets/')) throw httpError(404, 'Not found.');
        if (pathname.split('/').some(part => part.startsWith('.'))) throw httpError(404, 'Not found.');
        filePath = path.resolve(ROOT, '.' + pathname);
        if (!filePath.startsWith(ROOT + path.sep)) throw httpError(404, 'Not found.');
    }
    const file = await fs.readFile(filePath);
    res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': file.length,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': pathname === '/admin.html' || pathname.startsWith('/admin.js') || pathname === '/index.html'
            ? 'no-cache'
            : 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : file);
}

async function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname.startsWith('/api/')) {
            if (IS_VERCEL && url.pathname !== '/api/platform' && url.pathname !== '/api/catalog-events') {
                await initializeStore();
            }
            await handleApi(req, res, url);
        } else {
            await serveStatic(req, res, url);
        }
    } catch (error) {
        const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
        if (status >= 500) console.error(error);
        if (res.headersSent) return res.destroy();
        sendJson(res, status, {
            error: status === 500 ? 'An internal server error occurred.' : error.message
        });
    }
}

async function main() {
    await initializeStore();
    const server = http.createServer((req, res) => void handleRequest(req, res));
    server.listen(PORT, HOST, () => {
        console.log(`AZ TECH is listening on port ${PORT}.`);
        console.log(`Storefront: http://${HOST}:${PORT}/`);
        console.log(`Admin: http://${HOST}:${PORT}/admin`);
    });
}

if (require.main === module) {
    main().catch(error => {
        console.error('Could not start AZ TECH:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { handleRequest };
