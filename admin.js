'use strict';

const CATEGORIES = {
    telephones: 'Téléphones',
    laptops: 'Ordinateurs portables',
    accessoires: 'Accessoires',
    televiseurs: 'Téléviseurs',
    electromenagers: 'Électroménager'
};
const PERMISSION_LABELS = {
    'products.view': 'Voir les produits',
    'products.manage': 'Gérer les produits'
};

let currentUser = null;
let products = [];
let users = [];
let previewObjectUrl = null;

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
        if (response.status === 401 && url !== '/api/admin/login' && url !== '/api/admin/change-password') showLogin();
        throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
}

function formatPrice(value) {
    return new Intl.NumberFormat('fr-MA').format(value) + ' DH';
}

function showMessage(elementId, message, isError = false) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.className = `rounded-lg p-3 text-sm ${isError ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`;
}

function hideMessage(elementId) {
    document.getElementById(elementId).classList.add('hidden');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function showLogin() {
    currentUser = null;
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('account-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('admin-header-user').classList.add('hidden');
    document.getElementById('login-error').classList.add('hidden');
}

function showDashboard(user) {
    currentUser = user;
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('admin-header-user').classList.remove('hidden');
    document.getElementById('admin-header-user').classList.add('flex');
    document.getElementById('admin-username').textContent = user.username;
    if (user.forcePasswordChange) {
        document.getElementById('dashboard-view').classList.add('hidden');
        showAccountView(true);
        return;
    }
    document.getElementById('account-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');
    const canManageProducts = user.role === 'admin' || user.permissions.includes('products.manage');
    const canViewProducts = user.role === 'admin' || user.permissions.includes('products.view') || canManageProducts;
    const isAdmin = user.role === 'admin';
    document.querySelector('[data-panel="products-panel"]').classList.toggle('hidden', !canViewProducts);
    document.getElementById('products-management-content').classList.toggle('hidden', !canViewProducts);
    document.getElementById('products-access-denied').classList.toggle('hidden', canViewProducts);
    document.getElementById('add-product-button').classList.toggle('hidden', !canManageProducts);
    document.getElementById('add-product-button').classList.toggle('inline-flex', canManageProducts);
    document.getElementById('users-tab-button').classList.toggle('hidden', !isAdmin);
    document.getElementById('audit-tab-button').classList.toggle('hidden', !isAdmin);
    document.getElementById('new-user-role').disabled = !isAdmin;
    syncUserPermissionVisibility();
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.setAttribute('aria-current', String(tab.dataset.panel === 'products-panel'));
    });
    loadDashboard().catch(error => showMessage('products-message', error.message, true));
}

function showAccountView(isRequired = false) {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('account-view').classList.remove('hidden');
    document.getElementById('account-security-label').textContent = isRequired ? 'Action obligatoire' : 'Compte sécurisé';
    document.getElementById('account-title').textContent = isRequired
        ? 'Choisir un nouveau mot de passe'
        : 'Changer mon mot de passe';
    document.getElementById('account-description').textContent = isRequired
        ? 'Pour protéger votre espace, remplacez le mot de passe temporaire avant de continuer. Choisissez au moins 12 caractères.'
        : 'Choisissez un nouveau mot de passe d’au moins 12 caractères.';
    document.getElementById('cancel-account-button').classList.toggle('hidden', isRequired);
    document.getElementById('password-message').classList.add('hidden');
    document.getElementById('password-form').reset();
}

async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('password-message');
    message.classList.add('hidden');
    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) {
        showMessage('password-message', 'Les nouveaux mots de passe ne correspondent pas.', true);
        return;
    }
    try {
        const result = await api('/api/admin/change-password', {
            method: 'POST',
            body: JSON.stringify({
                currentPassword: form.elements.currentPassword.value,
                newPassword: form.elements.newPassword.value
            })
        });
        showDashboard(result.user);
    } catch (error) {
        showMessage('password-message', error.message, true);
    }
}

function syncUserPermissionVisibility() {
    const canManageUsers = currentUser?.role === 'admin';
    document.getElementById('new-user-permissions').classList.toggle(
        'hidden',
        !canManageUsers || document.getElementById('new-user-role').value === 'admin'
    );
}

async function loadDashboard() {
    const canViewProducts = currentUser.role === 'admin'
        || currentUser.permissions.includes('products.view')
        || currentUser.permissions.includes('products.manage');
    const [catalog, accountList] = await Promise.all([
        canViewProducts ? api('/api/products') : Promise.resolve(null),
        currentUser.role === 'admin' ? api('/api/admin/users') : Promise.resolve(null)
    ]);
    if (catalog) {
        products = catalog;
        renderProducts();
    }
    if (currentUser.role === 'admin') {
        users = accountList;
        renderUsers();
        await loadAudit();
    }
}

function renderProducts() {
    const query = document.getElementById('product-search').value.trim().toLowerCase();
    const canEdit = currentUser.role === 'admin' || currentUser.permissions.includes('products.manage');
    const filtered = products.filter(product =>
        `${product.title} ${product.brand} ${CATEGORIES[product.category] || ''}`.toLowerCase().includes(query)
    );
    document.getElementById('stat-products').textContent = products.length;
    document.getElementById('stat-promotions').textContent = products.filter(product => product.discount > 0).length;
    document.getElementById('stat-users').textContent = users.filter(user => user.isActive).length || (currentUser.role === 'admin' ? 0 : '—');
    document.getElementById('products-empty').classList.toggle('hidden', filtered.length > 0);
    document.getElementById('products-table-body').innerHTML = filtered.map(product => `
        <tr>
            <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                    <img src="${escapeHtml(product.img)}" alt="" class="h-12 w-12 rounded-lg bg-gray-100 object-contain" loading="lazy">
                    <div><p class="font-semibold text-brand-blue">${escapeHtml(product.title)}</p><p class="text-xs text-gray-500">${escapeHtml(product.brand)}</p></div>
                </div>
            </td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(CATEGORIES[product.category] || product.category)}</td>
            <td class="px-4 py-3 text-gray-500">${product.oldPrice ? formatPrice(product.oldPrice) : '—'}</td>
            <td class="px-4 py-3 font-semibold">${formatPrice(product.price)}</td>
            <td class="px-4 py-3">${product.discount ? `<span class="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-brand-orange">-${product.discount}%</span>` : '—'}</td>
            <td class="px-4 py-3 text-right">${canEdit ? `
                <div class="inline-flex gap-2">
                    <button type="button" data-edit-product="${product.id}" class="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-brand-blue transition hover:border-brand-orange">Modifier</button>
                    <button type="button" data-delete-product="${product.id}" class="rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50">Supprimer</button>
                </div>` : '<span class="text-xs text-gray-400">Lecture seule</span>'}</td>
        </tr>
    `).join('');
    document.getElementById('products-table-body').querySelectorAll('[data-edit-product]').forEach(button => {
        button.addEventListener('click', () => openProductDialog(Number(button.dataset.editProduct)));
    });
    document.getElementById('products-table-body').querySelectorAll('[data-delete-product]').forEach(button => {
        button.addEventListener('click', () => deleteProduct(Number(button.dataset.deleteProduct)));
    });
}

function openProductDialog(productId = null) {
    const form = document.getElementById('product-form');
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    form.reset();
    hideMessage('product-form-error');
    const product = productId ? products.find(item => item.id === productId) : null;
    document.getElementById('product-dialog-title').textContent = product ? 'Modifier l’article' : 'Ajouter un article';
    form.elements.id.value = product?.id || '';
    form.elements.title.value = product?.title || '';
    form.elements.brand.value = product?.brand || '';
    form.elements.category.value = product?.category || 'telephones';
    form.elements.price.value = product?.price ?? '';
    form.elements.oldPrice.value = product?.oldPrice || '';
    form.elements.img.value = product?.img || '';
    form.elements.description.value = product?.description || '';
    document.getElementById('product-image-name').textContent = product
        ? 'Image actuelle conservée si aucune nouvelle photo n’est choisie.'
        : 'Ajoutez une photo depuis votre appareil.';
    const preview = document.getElementById('product-image-preview');
    preview.src = product?.img || '';
    preview.classList.toggle('hidden', !product?.img);
    document.getElementById('product-dialog').showModal();
}

function readImageDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(new Error('Impossible de lire cette image.')));
        reader.readAsDataURL(file);
    });
}

async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    const imageFile = form.elements.imageFile.files[0];
    const product = {
        title: form.elements.title.value.trim(),
        brand: form.elements.brand.value.trim(),
        category: form.elements.category.value,
        price: Number(form.elements.price.value),
        oldPrice: Number(form.elements.oldPrice.value || 0),
        img: form.elements.img.value.trim(),
        description: form.elements.description.value.trim()
    };
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
        if (product.oldPrice > 0 && product.price > product.oldPrice) {
            throw new Error('Le prix actuel ne peut pas dépasser l’ancien prix.');
        }
        if (imageFile) {
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(imageFile.type)) {
                throw new Error('Choisissez une image PNG, JPEG, WebP ou GIF.');
            }
            if (imageFile.size > 5 * 1024 * 1024) throw new Error('La photo doit faire 5 Mo maximum.');
            const uploaded = await api('/api/admin/uploads/product-image', {
                method: 'POST',
                body: JSON.stringify({ dataUrl: await readImageDataUrl(imageFile) })
            });
            product.img = uploaded.img;
        }
        if (!product.img) throw new Error('Choisissez une photo pour cet article.');
        const result = await api(id ? `/api/admin/products/${id}` : '/api/admin/products', {
            method: id ? 'PUT' : 'POST',
            body: JSON.stringify(product)
        });
        if (id) products = products.map(item => item.id === Number(id) ? result.product : item);
        else products.push(result.product);
        document.getElementById('product-dialog').close();
        renderProducts();
        showMessage('products-message', 'Article enregistré avec succès.');
    } catch (error) {
        showMessage('product-form-error', error.message, true);
        document.getElementById('product-form-error').classList.remove('hidden');
    } finally {
        submitButton.disabled = false;
    }
}

async function deleteProduct(productId) {
    const product = products.find(item => item.id === productId);
    if (!product || !window.confirm(`Supprimer « ${product.title} » du catalogue ?`)) return;
    try {
        await api(`/api/admin/products/${productId}`, { method: 'DELETE' });
        products = products.filter(item => item.id !== productId);
        renderProducts();
        showMessage('products-message', 'Article supprimé du catalogue.');
    } catch (error) {
        showMessage('products-message', error.message, true);
    }
}

function renderUsers() {
    document.getElementById('stat-users').textContent = users.filter(user => user.isActive).length;
    document.getElementById('users-list').innerHTML = users.map(user => {
        const isSelf = user.id === currentUser.id;
        const permissionChecks = Object.entries(PERMISSION_LABELS).map(([permission, label]) => `
            <label class="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" data-user-permission="${permission}" ${user.permissions.includes(permission) ? 'checked' : ''} ${user.role === 'admin' || isSelf ? 'disabled' : ''} class="accent-brand-orange">
                ${label}
            </label>
        `).join('');
        return `
            <article class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div><h3 class="font-bold text-brand-blue">${escapeHtml(user.username)} ${isSelf ? '<span class="text-xs font-normal text-gray-400">(vous)</span>' : ''}</h3><p class="mt-1 text-xs text-gray-500">${user.isActive ? 'Compte actif' : 'Compte bloqué'}</p></div>
                    <span class="rounded-full ${user.role === 'admin' ? 'bg-red-50 text-brand-orange' : 'bg-gray-100 text-gray-600'} px-3 py-1 text-xs font-bold">${user.role === 'admin' ? 'Admin' : 'Utilisateur'}</span>
                </div>
                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                    <label class="text-xs font-semibold text-gray-600">Type de compte
                        <select data-user-role class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2" ${isSelf ? 'disabled' : ''}>
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>Utilisateur</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                    </label>
                    <label class="text-xs font-semibold text-gray-600">Nouveau mot de passe
                        <input data-user-password type="password" minlength="12" maxlength="200" autocomplete="new-password" placeholder="Laisser vide pour conserver" class="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 font-normal" ${isSelf ? 'disabled' : ''}>
                    </label>
                </div>
                <fieldset class="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                    <legend class="mb-2 w-full text-xs font-bold text-gray-600">Permissions</legend>${permissionChecks}
                </fieldset>
                <div class="mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                    ${!isSelf ? `<button type="button" data-toggle-user="${user.id}" data-active="${user.isActive}" class="rounded-lg border ${user.isActive ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-green-200 text-green-700 hover:bg-green-50'} px-3 py-2 text-xs font-semibold">${user.isActive ? 'Bloquer' : 'Débloquer'}</button>` : ''}
                    ${!isSelf ? `<button type="button" data-save-user="${user.id}" class="rounded-lg bg-brand-blue px-3 py-2 text-xs font-semibold text-white hover:bg-brand-light">Enregistrer</button>` : ''}
                </div>
            </article>
        `;
    }).join('');

    document.getElementById('users-list').querySelectorAll('[data-save-user]').forEach(button => {
        button.addEventListener('click', () => saveUser(button.closest('article'), button.dataset.saveUser));
    });
    document.getElementById('users-list').querySelectorAll('[data-toggle-user]').forEach(button => {
        button.addEventListener('click', () => toggleUser(button.dataset.toggleUser, button.dataset.active !== 'true'));
    });
}

async function saveUser(card, userId) {
    const permissionInputs = [...card.querySelectorAll('[data-user-permission]')];
    const data = {
        role: card.querySelector('[data-user-role]').value,
        permissions: permissionInputs.filter(input => input.checked).map(input => input.dataset.userPermission),
        password: card.querySelector('[data-user-password]').value
    };
    if (!data.password) delete data.password;
    try {
        await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(data) });
        showMessage('users-message', 'Compte et permissions mis à jour.');
        await loadDashboard();
    } catch (error) {
        showMessage('users-message', error.message, true);
    }
}

async function toggleUser(userId, isActive) {
    const user = users.find(item => item.id === userId);
    if (!user || !window.confirm(`${isActive ? 'Débloquer' : 'Bloquer'} le compte « ${user.username} » ?`)) return;
    try {
        await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
        showMessage('users-message', `Compte ${isActive ? 'débloqué' : 'bloqué'} avec succès.`);
        await loadDashboard();
    } catch (error) {
        showMessage('users-message', error.message, true);
    }
}

async function loadAudit() {
    const entries = await api('/api/admin/audit');
    document.getElementById('audit-list').innerHTML = entries.length ? entries.map(entry => `
        <article class="flex flex-wrap items-center justify-between gap-2 py-4">
            <div><p class="font-semibold text-brand-blue">${escapeHtml(entry.action)} <span class="font-normal text-gray-500">— ${escapeHtml(entry.subject)}</span></p><p class="mt-1 text-xs text-gray-500">Par ${escapeHtml(entry.actor)}</p></div>
            <time class="text-xs text-gray-500">${new Intl.DateTimeFormat('fr-MA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.at))}</time>
        </article>
    `).join('') : '<p class="py-8 text-center text-sm text-gray-500">Aucune activité enregistrée pour le moment.</p>';
}

async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = {
        username: form.elements.username.value.trim(),
        password: form.elements.password.value,
        role: form.elements.role.value,
        permissions: [...form.querySelectorAll('[name="permission"]:checked')].map(input => input.value)
    };
    try {
        await api('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
        form.reset();
        syncUserPermissionVisibility();
        showMessage('users-message', 'Compte créé avec succès.');
        await loadDashboard();
    } catch (error) {
        showMessage('users-message', error.message, true);
    }
}

function switchPanel(event) {
    const tab = event.currentTarget;
    if (tab.classList.contains('hidden')) return;
    document.querySelectorAll('.admin-tab').forEach(item => {
        item.setAttribute('aria-current', String(item === tab));
    });
    document.querySelectorAll('#dashboard-view > section[id$="-panel"]').forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== tab.dataset.panel);
    });
}

async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('login-submit');
    const errorBox = document.getElementById('login-error');
    errorBox.classList.add('hidden');
    button.disabled = true;
    button.textContent = 'Connexion…';
    try {
        const result = await api('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({
                username: form.elements.username.value,
                password: form.elements.password.value
            })
        });
        form.reset();
        showDashboard(result.user);
    } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.remove('hidden');
    } finally {
        button.disabled = false;
        button.textContent = 'Se connecter';
    }
}

async function logout() {
    try {
        await api('/api/admin/logout', { method: 'POST', body: '{}' });
    } finally {
        showLogin();
    }
}

async function restoreSession() {
    try {
        const result = await api('/api/admin/session');
        showDashboard(result.user);
    } catch (error) {
        if (error.message !== 'Please sign in again.') console.error('Could not restore admin session:', error);
        showLogin();
    }
}

document.getElementById('login-form').addEventListener('submit', login);
document.getElementById('logout-button').addEventListener('click', () => logout().catch(error => console.error('Logout failed:', error)));
document.getElementById('account-button').addEventListener('click', () => showAccountView(false));
document.getElementById('password-form').addEventListener('submit', changePassword);
document.getElementById('cancel-account-button').addEventListener('click', () => {
    if (currentUser) showDashboard(currentUser);
});
document.getElementById('user-form').addEventListener('submit', createUser);
document.getElementById('product-form').addEventListener('submit', saveProduct);
document.getElementById('add-product-button').addEventListener('click', () => openProductDialog());
document.getElementById('product-dialog-close').addEventListener('click', () => document.getElementById('product-dialog').close());
document.querySelector('#product-form [name="imageFile"]').addEventListener('change', event => {
    const file = event.currentTarget.files[0];
    const preview = document.getElementById('product-image-preview');
    if (!file) return;
    document.getElementById('product-image-name').textContent = file.name;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    preview.src = previewObjectUrl;
    preview.classList.remove('hidden');
});
document.getElementById('new-user-role').addEventListener('change', syncUserPermissionVisibility);
document.getElementById('product-search').addEventListener('input', renderProducts);
document.querySelectorAll('.admin-tab').forEach(button => button.addEventListener('click', switchPanel));
restoreSession();
