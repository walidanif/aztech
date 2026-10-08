'use strict';

const { handleRequest } = require('../server');

module.exports = async function handler(req, res) {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const resource = requestUrl.searchParams.get('resource');
    const id = requestUrl.searchParams.get('id');
    const productRoute = resource === 'products' && /^\d+$/.test(id || '');
    const userRoute = resource === 'users' && /^[0-9a-f-]{36}$/i.test(id || '');
    const imageUploadRoute = resource === 'uploads' && id === 'product-image';
    if (!productRoute && !userRoute && !imageUploadRoute) {
        res.statusCode = 404;
        res.end('Not found.');
        return;
    }
    req.url = imageUploadRoute
        ? '/api/admin/uploads/product-image'
        : `/api/admin/${resource}/${id}`;
    await handleRequest(req, res);
};
