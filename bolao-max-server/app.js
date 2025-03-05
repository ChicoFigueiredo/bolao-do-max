var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const redis = require('redis');

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const atualiza_redis = require('./atualiza-redis');

var app = express();

const getDurationInMilliseconds  = (start) => {
    const NS_PER_SEC = 1e9
    const NS_TO_MS = 1e6
    const diff = process.hrtime(start)

    return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS
}

app.use((req, res, next) => {
    console.log(`${req.method} ${req.originalUrl} [STARTED]`)
    const start = process.hrtime()

    res.on('finish', () => {            
        const durationInMilliseconds = getDurationInMilliseconds (start)
        console.log(`${req.method} ${req.originalUrl} [FINISHED] ${durationInMilliseconds.toLocaleString()} ms`)
    })

    res.on('close', () => {
        const durationInMilliseconds = getDurationInMilliseconds (start)
        console.log(`${req.method} ${req.originalUrl} [CLOSED] ${durationInMilliseconds.toLocaleString()} ms`)
    })

    next()
});

(async () => {
 
    app.client_redis = redis.createClient({
        username: 'default', // use your Redis user. More info https://redis.io/docs/management/security/acl/
        password: process.env.CACHE_PW || 'eYVX7EwVmmxKPC-DmwMtyKVge8oLd2t82', //'eYVX7EwVmmxKPC-DmwMtyKVge8oLd2t81', // use your password here
        socket: {
            host: process.env.CACHE_URL || 'localhost', // use your Redis server host
            port: process.env.CACHE_PORT || 6399, // use your Redis server port,
        }
    });
    app.client_redis.connect();
 
    app.client_redis.on("error", (error) => {
        console.error(error);
    });
 
    const result = await app.client_redis.set("maraca", "{ value = 'biloca2' }");
    console.log(`result: ${result}`);
 
    const result2 = await app.client_redis.get("maraca");
    console.log(`result2: ${result2}`);
 
})();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

atualiza_redis(app);

module.exports = app;