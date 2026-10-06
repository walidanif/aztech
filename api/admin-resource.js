'use strict';

const { handleRequest } = require('../server');

module.exports = async function handler(req, res) {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const resource = requestUrl.searchParams.get('resource');
    const id = requestUrl.searchParams.get('id');
    if (!['products', 'users'].includes(resource) || !/^[0-9a-f-]{1,64}$/i.test(id || '')) {
        res.statusCode = 404;
        res.end('Not found.');
        return;
    }
    req.url = `/api/admin/${resource}/${id}`;
    await handleRequest(req, res);
};
