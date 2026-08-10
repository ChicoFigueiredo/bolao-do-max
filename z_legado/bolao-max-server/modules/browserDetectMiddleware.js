// browserDetectMiddleware.js
const browser = require('browser-detect');

const MiddleWare = (res, req) => {
    res.locals.browser = browser(req.headers['user-agent']);
    next();
};

module.exports = MiddleWare;