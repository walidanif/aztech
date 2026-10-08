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
const ACTIVITY_LABELS = {
    'order.created': 'Nouvelle commande reçue',
    'order.confirmed': 'Commande confirmée',
    'order.delivered': 'Commande livrée',
    'order.cancelled': 'Commande annulée',
    'order.updated': 'Commande modifiée',
    'order.sheets_sync_failed': 'Échec de synchronisation Google Sheets',
    'password.change': 'Mot de passe modifié',
    'user.create': 'Compte créé',
    'user.update': 'Compte modifié',
    'product.create': 'Article ajouté',
    'product.update': 'Article modifié',
    'product.delete': 'Article supprimé',
    'product.image.upload': 'Photo d’article ajoutée'
};

let currentUser = null;
let products = [];
let users = [];
let orders = [];
let orderUnreadCount = 0;
let previewObjectUrl = null;
let activeOrder = null;
let ordersPollTimer = null;
let orderItemsDraft = [];

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    let data = {};
    if (response.status !== 204) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error(`L’API a répondu avec une page inattendue (HTTP ${response.status}). Vérifiez le déploiement et les logs Vercel.`);
        }
        try {
            data = await response.json();
        } catch {
            throw new Error(`La réponse de l’API est invalide (HTTP ${response.status}). Vérifiez les logs Vercel.`);
        }
    }
    if (!response.ok) {
        if (response.status === 401 && url !== '/api/admin/login' && url !== '/api/admin/change-password') showLogin();
        throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
}

function notifyCatalogUpdated() {
    try {
        localStorage.setItem('az-catalog-updated', String(Date.now()));
    } catch (error) {
        console.warn('Could not notify the storefront tab about the catalogue update:', error);
    }
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
    if (ordersPollTimer) clearInterval(ordersPollTimer);
    ordersPollTimer = null;
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
    document.getElementById('orders-tab-button').classList.toggle('hidden', !isAdmin);
    document.getElementById('new-user-role').disabled = !isAdmin;
    syncUserPermissionVisibility();
    const defaultPanel = isAdmin ? 'orders-panel' : 'products-panel';
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.setAttribute('aria-current', String(tab.dataset.panel === defaultPanel));
    });
    document.querySelectorAll('#dashboard-view > section[id$="-panel"]').forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== defaultPanel);
    });
    if (ordersPollTimer) clearInterval(ordersPollTimer);
    ordersPollTimer = isAdmin ? window.setInterval(() => {
        if (document.visibilityState === 'visible' && currentUser?.role === 'admin') {
            loadOrders().catch(error => console.error('Could not refresh orders:', error));
        }
    }, 30000) : null;
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
        await Promise.all([loadAudit(), loadOrders()]);
    }
}

const ORDER_STATUS_LABELS = {
    pending: 'En attente',
    confirmed: 'Confirmée',
    delivered: 'Livrée',
    cancelled: 'Annulée'
};

function formatDate(value) {
    return new Intl.DateTimeFormat('fr-MA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function localDateKey(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatOrderItems(order) {
    return order.items.map(item => `${item.title} × ${item.quantity}`).join(', ');
}

async function loadOrders(markRead = false) {
    const result = await api('/api/admin/orders');
    orders = result.orders;
    orderUnreadCount = result.unreadCount;
    if (markRead && orderUnreadCount) {
        await api('/api/admin/orders/notifications/read', { method: 'POST', body: '{}' });
        orderUnreadCount = 0;
        orders.forEach(order => { order.notificationRead = true; });
    }
    renderOrders();
}

function renderOrders(unreadCount = orderUnreadCount) {
    const badge = document.getElementById('orders-notification-badge');
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.classList.toggle('hidden', unreadCount === 0);
    const notification = document.getElementById('orders-notification');
    notification.classList.toggle('hidden', unreadCount === 0);
    notification.textContent = unreadCount
        ? `${unreadCount} nouvelle${unreadCount === 1 ? '' : 's'} commande${unreadCount === 1 ? '' : 's'} à traiter. Les commandes se mettent à jour automatiquement.`
        : '';

    const counts = Object.fromEntries(Object.keys(ORDER_STATUS_LABELS).map(status => [
        status,
        orders.filter(order => order.status === status).length
    ]));
    document.getElementById('orders-stat-total').textContent = orders.length;
    document.getElementById('orders-stat-pending').textContent = counts.pending;
    document.getElementById('orders-stat-confirmed').textContent = counts.confirmed;
    document.getElementById('orders-stat-delivered').textContent = counts.delivered;
    document.getElementById('orders-stat-cancelled').textContent = counts.cancelled;
    document.getElementById('orders-stat-revenue').textContent = formatPrice(
        orders.filter(order => order.status === 'delivered').reduce((sum, order) => sum + order.total, 0)
    );
    const confirmationsByAdmin = orders.reduce((totals, order) => {
        if (order.confirmedBy) totals[order.confirmedBy] = (totals[order.confirmedBy] || 0) + 1;
        return totals;
    }, {});
    document.getElementById('orders-confirmations-by-admin').innerHTML = Object.keys(confirmationsByAdmin).length
        ? Object.entries(confirmationsByAdmin).sort((a, b) => b[1] - a[1]).map(([name, count]) =>
            `<span class="rounded-full bg-gray-100 px-3 py-1"><strong>${escapeHtml(name)}</strong> : ${count} confirmation${count === 1 ? '' : 's'}</span>`
        ).join('')
        : '<span class="text-gray-500">Aucune commande confirmée pour le moment.</span>';

    const adminFilter = document.getElementById('orders-filter-admin');
    const selectedAdmin = adminFilter.value;
    const confirmers = [...new Set(orders.map(order => order.confirmedBy).filter(Boolean))].sort();
    adminFilter.innerHTML = '<option value="">Tous les admins</option>' + confirmers.map(name =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join('');
    adminFilter.value = confirmers.includes(selectedAdmin) ? selectedAdmin : '';

    const query = document.getElementById('orders-search').value.trim().toLocaleLowerCase();
    const status = document.getElementById('orders-filter-status').value;
    const from = document.getElementById('orders-filter-from').value;
    const to = document.getElementById('orders-filter-to').value;
    const confirmer = adminFilter.value;
    const filtered = orders.filter(order => {
        const text = `${order.id} ${order.customer.firstName} ${order.customer.lastName} ${order.customer.phone} ${order.customer.address} ${formatOrderItems(order)}`.toLocaleLowerCase();
        const day = localDateKey(order.createdAt);
        return (!query || text.includes(query))
            && (!status || order.status === status)
            && (!from || day >= from)
            && (!to || day <= to)
            && (!confirmer || order.confirmedBy === confirmer);
    });
    document.getElementById('orders-count-label').textContent = `${filtered.length} commande${filtered.length === 1 ? '' : 's'} affichée${filtered.length === 1 ? '' : 's'} sur ${orders.length}`;
    const body = document.getElementById('orders-table-body');
    body.innerHTML = filtered.map(order => {
        const canEdit = ['pending', 'confirmed'].includes(order.status);
        const statusClass = {
            pending: 'bg-amber-100 text-amber-900',
            confirmed: 'bg-blue-100 text-blue-900',
            delivered: 'bg-green-100 text-green-900',
            cancelled: 'bg-red-100 text-red-900'
        }[order.status];
        const syncLabel = order.sheetsSynced ? '' : '<span class="mt-1 block text-xs text-red-700">Non synchronisée avec Sheets</span>';
        return `<tr class="${order.notificationRead ? '' : 'bg-red-50/40'}">
            <td class="px-4 py-3 align-top"><time class="whitespace-nowrap">${escapeHtml(formatDate(order.createdAt))}</time><p class="mt-1 max-w-40 truncate font-mono text-[10px] text-gray-400" title="${escapeHtml(order.id)}">${escapeHtml(order.id)}</p>${syncLabel}</td>
            <td class="px-4 py-3 align-top"><p class="font-semibold">${escapeHtml(order.customer.firstName)} ${escapeHtml(order.customer.lastName)}</p><a class="mt-1 block text-xs text-blue-700 underline" href="tel:${escapeHtml(order.customer.phone)}">${escapeHtml(order.customer.phone)}</a><p class="mt-1 max-w-56 text-xs text-gray-500">${escapeHtml(order.customer.address)}</p></td>
            <td class="max-w-64 px-4 py-3 align-top text-xs">${escapeHtml(formatOrderItems(order))}</td>
            <td class="whitespace-nowrap px-4 py-3 align-top font-bold">${formatPrice(order.total)}</td>
            <td class="px-4 py-3 align-top"><span class="rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}">${ORDER_STATUS_LABELS[order.status]}</span>${order.confirmedBy ? `<p class="mt-2 text-xs text-gray-500">Par ${escapeHtml(order.confirmedBy)}</p>` : ''}${order.deliveredBy ? `<p class="mt-1 text-xs text-gray-500">Livrée par ${escapeHtml(order.deliveredBy)}</p>` : ''}</td>
            <td class="px-4 py-3 text-right align-top"><div class="flex flex-wrap justify-end gap-1">
                <button type="button" data-order-view="${order.id}" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs font-semibold hover:bg-gray-50">Détails</button>
                ${canEdit ? `<button type="button" data-order-edit="${order.id}" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs font-semibold hover:bg-gray-50">Modifier</button>` : ''}
                ${order.status === 'pending' ? `<button type="button" data-order-status="confirmed" data-order-id="${order.id}" class="rounded-md bg-blue-700 px-2 py-1.5 text-xs font-semibold text-white">Confirmer</button>` : ''}
                ${order.status === 'confirmed' ? `<button type="button" data-order-status="delivered" data-order-id="${order.id}" class="rounded-md bg-green-700 px-2 py-1.5 text-xs font-semibold text-white">Livrée</button>` : ''}
                ${['pending', 'confirmed'].includes(order.status) ? `<button type="button" data-order-status="cancelled" data-order-id="${order.id}" class="rounded-md border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700">Annuler</button>` : ''}
            </div></td>
        </tr>`;
    }).join('');
    document.getElementById('orders-empty').classList.toggle('hidden', filtered.length > 0);
    body.querySelectorAll('[data-order-view]').forEach(button => button.addEventListener('click', () => openOrderDialog(button.dataset.orderView)));
    body.querySelectorAll('[data-order-edit]').forEach(button => button.addEventListener('click', () => openOrderDialog(button.dataset.orderEdit, true)));
    body.querySelectorAll('[data-order-status]').forEach(button => button.addEventListener('click', () => updateOrderStatus(button.dataset.orderId, button.dataset.orderStatus, button)));
}

function renderOrderItemEditors() {
    const container = document.getElementById('order-edit-items');
    container.innerHTML = orderItemsDraft.map((item, index) => {
        const selectedExists = products.some(product => product.id === item.productId);
        const options = products.map(product =>
            `<option value="${product.id}" ${product.id === item.productId ? 'selected' : ''}>${escapeHtml(product.title)} — ${formatPrice(product.price)}</option>`
        );
        if (!selectedExists) options.unshift(`<option value="${item.productId}" selected>${escapeHtml(item.title)} (article archivé)</option>`);
        return `<div class="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
            <label class="text-xs font-semibold text-gray-600">Article<select data-order-item-product="${index}" class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm font-normal">${options.join('')}</select></label>
            <label class="text-xs font-semibold text-gray-600">Quantité<input data-order-item-quantity="${index}" type="number" min="1" max="20" required value="${item.quantity}" class="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal"></label>
            <button type="button" data-order-item-remove="${index}" aria-label="Supprimer l’article" class="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </div>`;
    }).join('');
    container.querySelectorAll('[data-order-item-product]').forEach(select => select.addEventListener('change', () => {
        const index = Number(select.dataset.orderItemProduct);
        const product = products.find(item => item.id === Number(select.value));
        if (product) orderItemsDraft[index] = { productId: product.id, title: product.title, quantity: orderItemsDraft[index].quantity };
    }));
    container.querySelectorAll('[data-order-item-quantity]').forEach(input => input.addEventListener('input', () => {
        orderItemsDraft[Number(input.dataset.orderItemQuantity)].quantity = Number(input.value);
    }));
    container.querySelectorAll('[data-order-item-remove]').forEach(button => button.addEventListener('click', () => {
        orderItemsDraft.splice(Number(button.dataset.orderItemRemove), 1);
        renderOrderItemEditors();
    }));
}

function openOrderDialog(orderId, editing = false) {
    activeOrder = orders.find(order => order.id === orderId);
    if (!activeOrder) return;
    const form = document.getElementById('order-form');
    form.reset();
    document.getElementById('order-dialog-message').classList.add('hidden');
    document.getElementById('order-dialog-title').textContent = editing ? 'Modifier la commande' : 'Détails de la commande';
    document.getElementById('order-dialog-kicker').textContent = `${ORDER_STATUS_LABELS[activeOrder.status]} — ${formatDate(activeOrder.createdAt)}`;
    document.getElementById('order-dialog-details').innerHTML = `<div class="grid gap-3 sm:grid-cols-2">
        <p><strong>Client :</strong> ${escapeHtml(activeOrder.customer.firstName)} ${escapeHtml(activeOrder.customer.lastName)}</p>
        <p><strong>Téléphone :</strong> <a class="text-blue-700 underline" href="tel:${escapeHtml(activeOrder.customer.phone)}">${escapeHtml(activeOrder.customer.phone)}</a></p>
        <p class="sm:col-span-2"><strong>Adresse / localisation :</strong> ${escapeHtml(activeOrder.customer.address)}</p>
        <div class="sm:col-span-2"><strong>Articles :</strong><ul class="mt-1 list-inside list-disc">${activeOrder.items.map(item => `<li>${escapeHtml(item.title)} — ${item.quantity} × ${formatPrice(item.unitPrice)} = ${formatPrice(item.lineTotal)}</li>`).join('')}</ul></div>
        <p><strong>Total :</strong> ${formatPrice(activeOrder.total)}</p>
        <p><strong>Référence :</strong> <span class="font-mono text-xs">${escapeHtml(activeOrder.id)}</span></p>
        ${activeOrder.confirmedBy ? `<p><strong>Confirmée par :</strong> ${escapeHtml(activeOrder.confirmedBy)} — ${escapeHtml(formatDate(activeOrder.confirmedAt))}</p>` : ''}
        ${activeOrder.deliveredBy ? `<p><strong>Livrée par :</strong> ${escapeHtml(activeOrder.deliveredBy)} — ${escapeHtml(formatDate(activeOrder.deliveredAt))}</p>` : ''}
        ${activeOrder.cancelledBy ? `<p><strong>Annulée par :</strong> ${escapeHtml(activeOrder.cancelledBy)} — ${escapeHtml(formatDate(activeOrder.cancelledAt))}</p>` : ''}
        <p><strong>Google Sheets :</strong> ${activeOrder.sheetsSynced ? 'Synchronisée' : 'À vérifier'}</p>
    </div>`;
    const editFields = document.getElementById('order-edit-fields');
    editFields.classList.toggle('hidden', !editing);
    form.elements.firstName.value = activeOrder.customer.firstName;
    form.elements.lastName.value = activeOrder.customer.lastName;
    form.elements.phone.value = activeOrder.customer.phone;
    form.elements.address.value = activeOrder.customer.address;
    orderItemsDraft = activeOrder.items.map(item => ({ ...item }));
    if (editing) renderOrderItemEditors();
    const canEdit = ['pending', 'confirmed'].includes(activeOrder.status);
    document.getElementById('order-confirm-button').classList.toggle('hidden', activeOrder.status !== 'pending');
    document.getElementById('order-deliver-button').classList.toggle('hidden', activeOrder.status !== 'confirmed');
    document.getElementById('order-cancel-button').classList.toggle('hidden', !canEdit);
    document.getElementById('order-edit-button').classList.toggle('hidden', !canEdit || editing);
    document.getElementById('order-save-button').classList.toggle('hidden', !editing);
    document.getElementById('order-dialog').showModal();
}

async function updateOrderStatus(orderId, status, actionButton = null) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;
    const action = { confirmed: 'confirmer', delivered: 'marquer comme livrée', cancelled: 'annuler' }[status];
    if (!window.confirm(`Voulez-vous ${action} la commande de ${order.customer.firstName} ${order.customer.lastName} ?`)) return;
    const orderDialog = document.getElementById('order-dialog');
    const isOrderDialogOpen = () => activeOrder?.id === orderId && orderDialog.open;
    if (actionButton) {
        actionButton.disabled = true;
        actionButton.textContent = 'En cours...';
    }
    const progressMessage = `Enregistrement de la commande (${ORDER_STATUS_LABELS[status].toLocaleLowerCase()})...`;
    if (isOrderDialogOpen()) showMessage('order-dialog-message', progressMessage);
    else showMessage('orders-message', progressMessage);
    try {
        const result = await api(`/api/admin/orders/${orderId}/status`, { method: 'POST', body: JSON.stringify({ status }) });
        if (!result.order || result.order.status !== status) {
            throw new Error('Le serveur n’a pas confirmé le changement de statut. Actualisez les commandes avant de réessayer.');
        }
        orders = orders.map(item => item.id === orderId ? result.order : item);
        renderOrders();
        const successMessage = result.alreadyApplied
            ? result.sheetsSynced
                ? `Cette commande était déjà ${ORDER_STATUS_LABELS[status].toLocaleLowerCase()} et synchronisée avec Google Sheets.`
                : `Cette commande était déjà ${ORDER_STATUS_LABELS[status].toLocaleLowerCase()}. La synchronisation Google Sheets est à vérifier.`
            : result.sheetsSynced
                ? `Commande ${ORDER_STATUS_LABELS[status].toLocaleLowerCase()} et synchronisée avec Google Sheets.`
                : `Commande ${ORDER_STATUS_LABELS[status].toLocaleLowerCase()} enregistrée. La synchronisation Google Sheets a échoué ; vérifiez le journal d’activité.`;
        showMessage('orders-message', successMessage, !result.sheetsSynced);
        if (isOrderDialogOpen()) {
            openOrderDialog(orderId);
            showMessage('order-dialog-message', successMessage, !result.sheetsSynced);
        }
        loadOrders().catch(error => {
            console.error('The order status was saved, but the order list could not be refreshed:', error);
            const refreshMessage = `Commande ${ORDER_STATUS_LABELS[status].toLocaleLowerCase()} enregistrée, mais la liste n’a pas pu être actualisée. Cliquez sur « Actualiser ».`;
            showMessage('orders-message', refreshMessage, true);
            if (isOrderDialogOpen()) showMessage('order-dialog-message', refreshMessage, true);
        });
        loadAudit().catch(error => console.error('The order status was saved, but the activity log could not be refreshed:', error));
    } catch (error) {
        showMessage('orders-message', error.message, true);
        if (isOrderDialogOpen()) showMessage('order-dialog-message', error.message, true);
    } finally {
        if (actionButton?.isConnected) {
            actionButton.disabled = false;
            actionButton.textContent = { confirmed: 'Confirmer', delivered: 'Livrée', cancelled: 'Annuler' }[status];
        }
    }
}

async function saveOrder(event) {
    event.preventDefault();
    if (!activeOrder) return;
    const form = event.currentTarget;
    try {
        const result = await api(`/api/admin/orders/${activeOrder.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                firstName: form.elements.firstName.value.trim(),
                lastName: form.elements.lastName.value.trim(),
                phone: form.elements.phone.value.trim(),
                address: form.elements.address.value.trim(),
                items: orderItemsDraft.map(item => ({ productId: item.productId, quantity: item.quantity }))
            })
        });
        document.getElementById('order-dialog').close();
        showMessage('orders-message', result.sheetsSynced
            ? 'Commande modifiée et synchronisée avec Google Sheets.'
            : 'Commande modifiée dans l’administration, mais la synchronisation Sheets a échoué.', !result.sheetsSynced);
        await Promise.all([loadOrders(), loadAudit()]);
    } catch (error) {
        const message = document.getElementById('order-dialog-message');
        message.textContent = error.message;
        message.className = 'rounded-lg bg-red-50 p-3 text-sm text-red-700';
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
            const platform = await api('/api/platform');
            const uploaded = platform.serverless
                ? await api('/api/admin/uploads/product-image', {
                    method: 'POST',
                    body: JSON.stringify({ contentType: imageFile.type })
                })
                : await api('/api/admin/uploads/product-image', {
                    method: 'POST',
                    body: JSON.stringify({ dataUrl: await readImageDataUrl(imageFile) })
                });
            if (uploaded.uploadUrl) {
                const response = await fetch(uploaded.uploadUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': imageFile.type },
                    body: imageFile
                });
                if (!response.ok) throw new Error('Impossible d’enregistrer la photo dans Supabase.');
            }
            product.img = uploaded.img;
        }
        if (!product.img) throw new Error('Choisissez une photo pour cet article.');
        const result = await api(id ? `/api/admin/products/${id}` : '/api/admin/products', {
            method: id ? 'PUT' : 'POST',
            body: JSON.stringify(product)
        });
        if (id) products = products.map(item => item.id === Number(id) ? result.product : item);
        else products.push(result.product);
        notifyCatalogUpdated();
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
        notifyCatalogUpdated();
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
            <div><p class="font-semibold text-brand-blue">${escapeHtml(ACTIVITY_LABELS[entry.action] || entry.action)} <span class="font-normal text-gray-500">— ${escapeHtml(entry.subject)}</span></p><p class="mt-1 text-xs text-gray-500">Par ${escapeHtml(entry.actor)}</p>${entry.details ? `<p class="mt-1 max-w-3xl text-xs text-gray-600">${escapeHtml(entry.details)}</p>` : ''}</div>
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
    if (tab.dataset.panel === 'orders-panel') {
        loadOrders(true).catch(error => showMessage('orders-message', error.message, true));
    } else if (tab.dataset.panel === 'audit-panel') {
        loadAudit().catch(error => console.error('Could not load activity:', error));
    }
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

async function checkAdminServiceHealth() {
    const message = document.getElementById('admin-service-health');
    try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const result = await response.json();
        if (result.ready) {
            message.classList.add('hidden');
            return;
        }
        message.textContent = result.message || 'Le stockage de l’administration est indisponible.';
        message.className = 'mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800';
    } catch (error) {
        console.error('Could not check admin service health:', error);
        message.textContent = 'Impossible de vérifier le stockage. Consultez les logs Vercel.';
        message.className = 'mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800';
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
document.getElementById('orders-search').addEventListener('input', () => renderOrders());
document.getElementById('orders-filter-status').addEventListener('change', () => renderOrders());
document.getElementById('orders-filter-from').addEventListener('change', () => renderOrders());
document.getElementById('orders-filter-to').addEventListener('change', () => renderOrders());
document.getElementById('orders-filter-admin').addEventListener('change', () => renderOrders());
document.getElementById('orders-refresh-button').addEventListener('click', () => {
    loadOrders().catch(error => showMessage('orders-message', error.message, true));
});
document.getElementById('order-form').addEventListener('submit', saveOrder);
document.getElementById('order-dialog-close').addEventListener('click', () => document.getElementById('order-dialog').close());
document.getElementById('order-edit-button').addEventListener('click', () => {
    if (activeOrder) openOrderDialog(activeOrder.id, true);
});
document.getElementById('order-add-item').addEventListener('click', () => {
    const product = products[0];
    if (!product) return;
    orderItemsDraft.push({ productId: product.id, title: product.title, quantity: 1 });
    renderOrderItemEditors();
});
document.getElementById('order-confirm-button').addEventListener('click', () => {
    if (activeOrder) updateOrderStatus(activeOrder.id, 'confirmed', document.getElementById('order-confirm-button'));
});
document.getElementById('order-deliver-button').addEventListener('click', () => {
    if (activeOrder) updateOrderStatus(activeOrder.id, 'delivered', document.getElementById('order-deliver-button'));
});
document.getElementById('order-cancel-button').addEventListener('click', () => {
    if (activeOrder) updateOrderStatus(activeOrder.id, 'cancelled', document.getElementById('order-cancel-button'));
});
document.querySelectorAll('.admin-tab').forEach(button => button.addEventListener('click', switchPanel));
restoreSession();
checkAdminServiceHealth();
