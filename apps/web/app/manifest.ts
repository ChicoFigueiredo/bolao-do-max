import type { MetadataRoute } from 'next'

/**
 * O manifest é o que torna o site instalável — não há tag que mande o navegador
 * oferecer a instalação, só este arquivo, que o deixa elegível. O Next serve
 * isto em `/manifest.webmanifest` e injeta o `<link rel="manifest">` sozinho.
 *
 * Os critérios do Chromium são exatamente os campos abaixo mais HTTPS: nome,
 * `start_url`, `display` fora de `browser`, e ícones de 192 e 512. Service
 * worker não entra mais na conta — o requisito caiu, e por isso aqui não há
 * cache offline nenhum: o bolão é dado ao vivo, e uma tabela velha guardada em
 * cache seria pior do que uma tela dizendo que faltou rede.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Bolão do Max',
    short_name: 'Bolão',
    description: 'Resultados em tempo real do Bolão do Max — Brasileirão Série A',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'pt-BR',
    dir: 'ltr',
    categories: ['sports'],
    // A cor da barra do sistema e a do splash acompanham o tema ocre, que é o
    // padrão da casa e o que o `<html>` já traz do servidor.
    background_color: '#efe3cc',
    theme_color: '#efe3cc',
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // O Android recorta o ícone na forma que o aparelho usa. Sem uma versão
      // `maskable`, ele corta a bola pelas bordas; esta tem a bola a 80% sobre
      // campo ocre, então sobra margem para qualquer máscara comer.
      { src: '/icone-mascara-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
