var express = require('express');
var moment = require('moment');
var cors = require('cors')
var router = express.Router();
//var cb = require('campeonato-brasileiro');
const cb = require('../helper/campeonato-brasileiro-modificado-chico');
const browser = require('browser-detect');
const regra_bolao = require('../helper/regras.bolao');
const serie = 'a';

/* GET home page. */
router.get('/', async (req, res, next) => {
    const redis = req.app.client_redis;
    const brw = browser(req.headers['user-agent']);
    if (redis) {
        const bolao = JSON.parse(await redis.get('bolao_mem'));
        const titulo = bolao.titulo;
        await redis.set('data_last_get',moment().format());
        res.render('index', { bolao, brw, titulo });
    } else {
        res.send(500);
    }
});


/* GET home page. */
router.get('/resultados', cors(), async (req, res, next) => {
    const redis = req.app.client_redis;
    if (redis) {
        const bolao = JSON.parse(await redis.get('bolao_mem'));
        await redis.set('data_last_get',moment().format());
        res.send(bolao);
    } else {
        res.send({ msg : 'Cache com erro!'});
    }
});

module.exports = router;