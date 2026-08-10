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
 *
 * O ocre é o padrão sempre, e o sistema operacional não opina. Antes ele
 * opinava: celular no escuro abria o bolão no escuro. O ocre é a assinatura da
 * casa e é o que a pessoa deve ver na primeira visita; quem quiser escuro
 * escolhe no menu, e a escolha fica guardada.
 *
 * O `<html>` já vem com `data-tema="ocre"` do servidor, então aqui só há
 * trabalho quando existe escolha gravada — e só para os dois temas que não são
 * o padrão. Valor estranho no storage não muda nada, o que é a degradação certa.
 */
const TEMA_ANTES_DE_PINTAR = `
(function(){try{var t=localStorage.getItem('bolao:tema');
if(t==='claro'||t==='escuro')document.documentElement.setAttribute('data-tema',t);}catch(e){}})();
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
