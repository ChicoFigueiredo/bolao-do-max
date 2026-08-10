import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bolão do Max',
  description: 'Resultados em tempo real do Bolão do Max — Brasileirão Série A',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

/**
 * Aplica o tema antes da primeira pintura. Sem isto a página aparece no tema
 * errado por um quadro e pisca — que é o defeito mais visível de quem faz
 * troca de tema no cliente.
 */
const TEMA_ANTES_DE_PINTAR = `
(function(){try{var t=localStorage.getItem('bolao:tema');
if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'escuro':'ocre';}
document.documentElement.setAttribute('data-tema',t);}catch(e){document.documentElement.setAttribute('data-tema','ocre');}})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-tema="ocre">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: TEMA_ANTES_DE_PINTAR }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
