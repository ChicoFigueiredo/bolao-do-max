const currentYear = () => new Date().getFullYear();

calcula_bolao = (tabela) => {
    // colocando a classificação na tabela do brasileirão
    p = 1;
    tabela.forEach(t => { t.posicao = p++; });

    let bolao = require('../json/bolao.json');
    i = 0;

    pontuacao = (time) => { return tabela.filter(t => { return t.nome === time })[0] }
    bolao.Competidores.forEach(b => {
        let pontuacaoCompetidor = 0;
        let saldoGols = 0;
        let golsPro = 0

        // Bolão tradicional
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
                //throw 'Erro no time ' + t.Clube;
            }
        });
        b.Pontos = Number(pontuacaoCompetidor);
        b.Saldo_Gols = Number(saldoGols);
        b.golsPro = Number(golsPro);

        // Novo Bolão
        b.PalpitesPosicao.forEach(t => {
            t.acertoG4 = false;
            t.acertoZ4 = false;
            t.pontos = 0;
            let posicaoAtual = pontuacao(t.Clube);
            if (posicaoAtual) {
                if (t.Clube === posicaoAtual.nome) {
                    if (t.posicao >= 1 && t.posicao <= 4 && posicaoAtual.posicao <= 4) {
                        t.acertoG4 = true;
                        t.pontos = 1;
                    }
                    if (t.posicao >= 17 && t.posicao <= 20 && posicaoAtual.posicao >= 17) {
                        t.acertoZ4 = true;
                        t.pontos = 1;
                    }
                    if (t.posicao == posicaoAtual.posicao) {
                        t.acertoPosicao = true;
                        t.pontos += 3;
                    }
                    t.posicaoAtualTime = posicaoAtual.posicao;
                }
            } else {
                //throw 'Erro no time ' + t.Clube;
            }
        });

        b.PontosG4Z4 = b.PalpitesPosicao.reduce((acc, t) =>  acc + t.pontos , 0);
        b.AcertosG4Z4 = b.PalpitesPosicao.reduce((acc, t) =>  acc + (t.acertoG4 ? 1 : 0) + (t.acertoZ4 ? 1 : 0) , 0);
        b.AcertosG4 = b.PalpitesPosicao.reduce((acc, t) =>  acc + (t.acertoG4 ? 1 : 0) , 0);
        b.AcertosZ4 = b.PalpitesPosicao.reduce((acc, t) =>  acc + (t.acertoZ4 ? 1 : 0) , 0);
    });

    // Bolão Clássico
    bolao.Competidores = bolao.Competidores.sort((a, b) => {
        if (a.Pontos < b.Pontos) return +1;
        if (a.Pontos > b.Pontos) return -1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols < b.Saldo_Gols) return +1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols > b.Saldo_Gols) return -1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro < b.golsPro) return +1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro > b.golsPro) return -1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro == b.golsPro && a.golsContra > b.golsContra ) return +1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro == b.golsPro && a.golsContra < b.golsContra ) return -1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro == b.golsPro && a.golsContra == b.golsContra && a.Nome > b.Nome) return +1;
        if (a.Pontos == b.Pontos && a.Saldo_Gols == b.Saldo_Gols && a.golsPro == b.golsPro && a.golsContra == b.golsContra && a.Nome < b.Nome) return -1;
        return 0;
    });
    pos = 0;
    bolao.Competidores.forEach(b => {
        pos++;
        b.Posicao = pos;
        b.Premio = pos == 1 ? 'R$ 2.000,00' : pos == 2 ? 'R$ 600,00' : pos == 3 ? 'R$ 300,00' : pos == bolao.Competidores.length ? 'R$ 120,00' : '-';
    });

    // Bolão Novo
    bolao.BolaoNovo = bolao.Competidores.slice(0);
    bolao.BolaoNovo = bolao.BolaoNovo.sort((a, b) => {
        if (a.PontosG4Z4 < b.PontosG4Z4) return +1;
        if (a.PontosG4Z4 > b.PontosG4Z4) return -1;
        if (a.PontosG4Z4 == b.PontosG4Z4 && a.AcertosG4Z4 < b.AcertosG4Z4) return +1;
        if (a.PontosG4Z4 == b.PontosG4Z4 && a.AcertosG4Z4 > b.AcertosG4Z4) return -1;
        if (a.PontosG4Z4 == b.PontosG4Z4 && a.AcertosG4Z4 == b.AcertosG4Z4 && a.AcertosG4 < b.AcertosG4) return +1;
        if (a.PontosG4Z4 == b.PontosG4Z4 && a.AcertosG4Z4 == b.AcertosG4Z4 && a.AcertosG4 > b.AcertosG4) return -1;
        if (a.PontosG4Z4 == b.PontosG4Z4 && a.AcertosG4Z4 == b.AcertosG4Z4 && a.AcertosG4 == b.AcertosG4 && a.AcertosZ4 < b.AcertosZ4) return +1;
        if (a.PontosG4Z4 == b.PontosG4Z4 && a.AcertosG4Z4 == b.AcertosG4Z4 && a.AcertosG4 == b.AcertosG4 && a.AcertosZ4 > b.AcertosZ4) return -1;
        return 0;
    });
    pos = 0;
    pontosAnterior = 0;
    dividirPremio = 1;
    bolao.BolaoNovo.forEach(b => {
        pos++;
        b.PosicaoG4Z4 = pos;
        if (pos > 1) {
            if (b.PontosG4Z4 == pontosAnterior) {
                dividirPremio++;
                b.PosicaoG4Z4 = 1;
            } else {
                pontosAnterior = -1;
            }
        } else {
            pontosAnterior = b.PontosG4Z4;
        }
    });
    
    bolao.BolaoNovo.forEach(b => {
        b.PremioG4Z4 = b.PosicaoG4Z4 == 1 ? 'R$ ' + (1000 / dividirPremio).toFixed(2) : '-';
    });


    bolao.ano = currentYear();
    bolao.titulo = "Bolão do Max - " + bolao.ano + "";
    return bolao;
}

module.exports = calcula_bolao;