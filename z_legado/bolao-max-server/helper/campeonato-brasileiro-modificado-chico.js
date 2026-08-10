const cb = require('campeonato-brasileiro');
var request = require('request')

/** Alteração para puxar o dado correto */
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
           //teste.compile();
            var g = teste.exec(html);
            if (g){
                if (g[1]) {
                    const jsonCampeonato = JSON.parse(g[1]);
                    const classificacao = jsonCampeonato.classificacao;
                    var lista = [];
                    classificacao.forEach(time => {
                        lista.push({
                            nome : time.nome_popular,
                            pontos : time.pontos,
                            jogos : time.jogos,
                            vitorias : time.vitorias,
                            empates : time.empates,
                            derrotas : time.derrotas,
                            golsPro : time.gols_pro,
                            golsContra : time.gols_contra,
                            saldoGols : time.saldo_gols,
                            percentual : time.aproveitamento
                        })
                    });
                    acept(lista);
                }
            }
        } else {
          error({ error:"Não foi possível retornar as informações!" });
        }
      });
    });
  };

module.exports = cb;