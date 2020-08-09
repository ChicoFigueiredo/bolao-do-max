var express = require('express');
var router = express.Router();
var cb = require('campeonato-brasileiro');

cb.tabela = function(serie) {
    return new Promise(function(acept, error) {
      var options = {
        url: 'https://globoesporte.globo.com/futebol/brasileirao-serie-' + serie,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2228.0 Safari/537.36'
        }
      };
      request(options, function(error, response, html) {
        if(!error) {

            const teste = /const classificacao = (.*?);\n/gmi;
            teste.compile();
            var g = teste.exec(html);
            if (g){
                if (g[1]) {
                    var jsonCampeonato = JSON.parse(g[1]);
                    console.log(JSON.stringify(jsonCampeonato,null,3));
                }
            }
        
        //   var $ = cheerio.load(html);
        //   var lista = [];
  
        //   $('.tabela-times tbody tr').each(function() {
        //     var item = $(this);
        //     var time = {};
        //     time.nome = item.find('.tabela-times-time-nome').text();
        //     lista.push(time);
        //   });
        //   var x = 0;
        //   $('.tabela-pontos tbody tr').each(function() {
        //     var item = $(this);
        //     lista[x].pontos = item.find('.tabela-pontos-ponto').text();
        //     lista[x].jogos = item.find('.tabela-pontos-ponto').next().text();
        //     lista[x].vitorias = item.find('.tabela-pontos-ponto').next().next().text();
        //     lista[x].empates = item.find('.tabela-pontos-ponto').next().next().next().text();
        //     lista[x].derrotas = item.find('.tabela-pontos-ponto').next().next().next().next().text();
        //     lista[x].golsPro = item.find('.tabela-pontos-ponto').next().next().next().next().next().text();
        //     lista[x].golsContra = item.find('.tabela-pontos-ponto').next().next().next().next().next().next().text();
        //     lista[x].saldoGols = item.find('.tabela-pontos-ponto').next().next().next().next().next().next().next().text();
        //     lista[x].percentual = item.find('.tabela-pontos-ponto').next().next().next().next().next().next().next().next().text();
        //     x++;
        //   });
        //   acept(lista);
        // } else {
        //   error({ error:"Não foi possível retornar as informações!" });
        // }
      });
    });
  };

/* GET users listing. */
router.get('/', function(req, res, next) {
    var serie = 'a';

    cb.tabela(serie).then(function(tabela) {
        console.log(tabela);
        res.send(JSON.stringify(tabela, null, 3));
    }, function(err) {
        console.log(err);
    });
});


/* GET users listing. */
router.get('/tabela', function(req, res, next) {
    var serie = 'a';
    let bolao = require('../json/bolao.json');
    i = 0;
    //res.render('bolao', { bolao, i });

    cb.tabela(serie).then(function(tabela) {
        pontuacao = (time) => { return tabela.filter(t => { return t.nome === time })[0] }
        bolao.Competidores.forEach(b => {
            let pontuacaoCompetidor = 0;
            let saldoGols = 0;
            let golsPro = 0
            b.Clubes.forEach(t => {
                pontuacaoAtual = pontuacao(t.Clube);
                if (pontuacaoAtual) {
                    t.pontos = pontuacaoAtual.pontos;
                    pontuacaoCompetidor += Number(t.pontos);
                    t.jogos = pontuacaoAtual.jogos;
                    t.vitorias = pontuacaoAtual.vitorias;
                    t.empates = pontuacaoAtual.empates;
                    t.derrotas = pontuacaoAtual.derrotas;
                    t.golsPro = pontuacaoAtual.golsPro;
                    golsPro += Number(t.golsPro);
                    t.golsContra = pontuacaoAtual.golsContra;
                    t.saldoGols = pontuacaoAtual.saldoGols;
                    saldoGols += Number(t.saldoGols);
                    t.percentual = pontuacaoAtual.percentual;
                } else {
                    throw 'Erro no time ' + t.Clube;
                }
            });
            b.Pontos = Number(pontuacaoCompetidor);
            b.Saldo_Gols = Number(saldoGols);
            b.golsPro = Number(golsPro);
        });
        bolao.Competidores = bolao.Competidores.sort((a, b) => {
            if (a.Pontos < b.Pontos) return +1;
            if (a.Pontos > b.Pontos) return -1;
            if (a.Pontos == b.Pontos && a.Saldo_Gols < b.Saldo_Gols) return +1;
            if (a.Pontos == b.Pontos && a.Saldo_Gols > b.Saldo_Gols) return -1;
            if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro < b.golsPro) return +1;
            if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro > b.golsPro) return -1;
            if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro == b.golsPro) return 0;
        });
        i = 0;
        bolao.Competidores.forEach(b => {
            i++;
            b.Posicao = i;
            b.Premio = i == 1 ? 'R$ 2.000,00' : i == 2 ? 'R$ 600,00' : i == 3 ? 'R$ 300,00' : i == bolao.Competidores.length ? 'R$ 120,00' : '';
        });
        res.render('bolao', { bolao });
    }, function(err) {
        console.log(err);
    });
});

module.exports = router;