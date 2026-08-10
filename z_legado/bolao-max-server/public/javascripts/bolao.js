function demonstrativo(a) {
    res = '';
    res += a.Nome + ': ' + a.Pontos + ' pontos / Saldo Gols: ' + a.Saldo_Gols + ' \n \n';
    a.Clubes.forEach(e => {
        res += '  ' + e.Clube + ': '
        res += e.pontos + ' Pontos / '
        res += ' Saldo Gols: ' + e.saldoGols + ' / '
        res += ' Jogos: ' + e.jogos + ''
        res += '\n\n'
    });

    alert(res);
}

function demonstrativoG4Z4(a) {
    res = '';
    res += a.Nome + ': ' + a.PontosG4Z4 + ' pontos \n \n';
    a.PalpitesPosicao.forEach(t => {
        res += '  ' + t.Clube + ': '
        res += ' Chute ' + t.posicao 
        res += ' | Posição Atual ' + t.posicaoAtualTime 
        res += ' | ' + ((t.acertoPosicao) ? '✅ 4 pontos ' : '') + ( (!t.acertoPosicao) && (t.acertoG4 || t.acertoZ4) ? '👍 1 ponto' : '')
        res += '\n\n'
    });

    alert(res);
}