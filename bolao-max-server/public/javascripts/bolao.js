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