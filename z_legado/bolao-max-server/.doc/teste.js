var cb = require('campeonato-brasileiro');
 
var ano = 2020;
var serie = 'a';
 
cb.jogos(ano, serie).then(function(jogos) {
    console.log(jogos);
}, function(err){
    console.log(err);
});