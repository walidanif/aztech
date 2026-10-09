'use strict';

const { handleRequest } = require('../../server');

module.exports = async function handler(req, res) {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const filename = requestUrl.pathname.slice('/api/uploads/'.length);
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i.test(filename)) {
        res.statusCode = 404;
        res.end('Not found.');
        return;
    }
    req.url = `/api/uploads/${filename}`;
    await handleRequest(req, res);
};
