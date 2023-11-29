const cron = require('node-cron');
const moment = require('moment');
const cb = require('./helper/campeonato-brasileiro-modificado-chico');
const regra_bolao = require('./helper/regras.bolao');
const serie = 'a';

const atualiza_cache = (app) => {
    const redis = app.client_redis;
    try {
        cb.tabela(serie).then(async (tabela) => {
            bolao = regra_bolao(tabela);
            bolao.atualizado_em = moment().format(); 
            await redis.set('bolao_mem', JSON.stringify(bolao));
            await redis.set('bolao_data_atu', bolao.atualizado_em);
            console.log(`Bolao atualizado ${moment().format()}`);
        }, function(err) {
            console.log(err);
        });
    } catch (err) {
        console.log(err);
    }
}

module.exports = function(app){
    atualiza_cache(app);

    cron.schedule('*/3 * * * *', async () => {
        const redis = app.client_redis;
        const data_last_get = await redis.get('data_last_get')
        const data_atu = moment(data_last_get).add(21,'minutes')
        if (moment().isSameOrBefore(data_atu)){
            atualiza_cache(app);
        }
        
    });

    cron.schedule('*/60 * * * *', async () => {
        const redis = app.client_redis;
        atualiza_cache(app);
    });
}

