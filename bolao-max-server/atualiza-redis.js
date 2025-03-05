const cron = require('node-cron');
const moment = require('moment-timezone');
const cb = require('./helper/campeonato-brasileiro-modificado-chico');
const regra_bolao = require('./helper/regras.bolao');
const serie = 'a';
moment.locale('pt-br');
console.log(moment.locale());

const atualiza_cache = (app) => {
    const redis = app.client_redis;
    try {
        cb.tabela(serie).then(async (tabela) => {
            bolao = regra_bolao(tabela);
            bolao.atualizado_em = moment().tz('America/Sao_Paulo').format('DD/MMM/yyyy HH:mm:ss'); 
            await redis.set('bolao_mem', JSON.stringify(bolao));
            await redis.set('bolao_data_atu', bolao.atualizado_em);
            console.log(`Bolao atualizado ${moment().tz('America/Sao_Paulo').format()}`);
        }, function(err) {
            console.log(err);
        });
    } catch (err) {
        console.log(err);
    }
}

module.exports = function(app){
    atualiza_cache(app);
    var atualizacao_quando_acessada = process.env.MINUTOS_QUANDO_ACESSADO || 3
    var atualizacao_recorrente = process.env.MINUTOS_QUANDO_NAO_ACESSADO || 1

    cron.schedule(`*/${atualizacao_quando_acessada} * * * *`, async () => {
        const redis = app.client_redis;
        const data_last_get = await redis.get('data_last_get')
        const data_atu = moment(data_last_get).add(21,'minutes')
        if (moment().isSameOrBefore(data_atu)){
            atualiza_cache(app);
        }
        
        });

    cron.schedule(`*/${atualizacao_recorrente} * * * *`, async () => {
        const redis = app.client_redis;
        atualiza_cache(app);
    });
}

