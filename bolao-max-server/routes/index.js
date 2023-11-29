var express = require('express');
var moment = require('moment');
var cors = require('cors')
var router = express.Router();
//var cb = require('campeonato-brasileiro');
const cb = require('../helper/campeonato-brasileiro-modificado-chico');
const browser = require('browser-detect');
const regra_bolao = require('../helper/regras.bolao');
const serie = 'a';
const brw = 'sei-lado';

/* GET home page. */
router.get('/', function(req, res, next) {
    cb.tabela(serie).then(async (tabela) => {
        //bolao = regra_bolao(tabela);
        const redis = req.app.client_redis;
        if (redis) {
            const bolao = JSON.parse(await redis.get('bolao_mem'));
            const titulo = bolao.titulo;
            await redis.set('data_last_get',moment().format());
            res.render('index', { bolao, brw, titulo });
        } else {
            res.send(500);
        }
    }, function(err) {
        console.log(err);
    });
});


/* GET home page. */
router.get('/resultados', cors(), function(req, res, next) {
    cb.tabela(serie).then(async (tabela) => {
        //bolao = regra_bolao(tabela);
        const redis = req.app.client_redis;
        if (redis) {
            const bolao = JSON.parse(await redis.get('bolao_mem'));
            await redis.set('data_last_get',moment().format());
            res.send(bolao);
        } else {
            res.send({ msg : 'Cache com erro!'});
        }
    }, function(err) {
        console.log(err);
    });
});

module.exports = router;