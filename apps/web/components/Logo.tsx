/**
 * Marca do Bolão do Max — uma bola de futebol.
 *
 * Portada do protótipo. Usa as variáveis de tema em vez de cor fixa, então
 * acompanha ocre, claro e escuro sem versão separada.
 *
 * Os pentágonos de fora extrapolam o círculo de propósito e são recortados pelo
 * `clipPath`: é o que dá a sensação de superfície esférica, com os gomos
 * cortados na borda como numa bola de verdade.
 *
 * `id` existe porque o `clipPath` precisa ser único no documento — se a marca
 * aparecer duas vezes na mesma tela, a segunda tem que passar outro.
 */
export function Logo({ id = 'bolaMax', className }: { id?: string; className?: string }) {
  const clip = `${id}Clip`
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Bolão do Max"
      className={className}
      style={{
        flex: 'none',
        width: 'clamp(32px,8vw,42px)',
        height: 'clamp(32px,8vw,42px)',
        marginTop: 1,
        display: 'block',
      }}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r="29.2" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="29.2" fill="var(--surf)" />
      <g clipPath={`url(#${clip})`}>
        <g fill="var(--ink)">
          <polygon points="32.00,20.50 42.94,28.45 38.76,41.30 25.24,41.30 21.06,28.45" />
          <polygon points="54.33,1.26 58.15,12.99 48.16,20.25 38.17,12.99 41.99,1.26" />
          <polygon points="68.14,43.74 58.15,51.00 48.16,43.74 51.98,32.01 64.32,32.01" />
          <polygon points="32.00,70.00 22.01,62.74 25.83,51.01 38.17,51.01 41.99,62.74" />
          <polygon points="-4.14,43.74 -0.32,32.01 12.02,32.01 15.84,43.74 5.85,51.00" />
          <polygon points="9.67,1.26 22.01,1.26 25.83,12.99 15.84,20.25 5.85,12.99" />
        </g>
        <g stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M32.00,20.50 32.00,1.00" />
          <path d="M42.94,28.45 61.48,22.42" />
          <path d="M38.76,41.30 50.22,57.08" />
          <path d="M25.24,41.30 13.78,57.08" />
          <path d="M21.06,28.45 2.52,22.42" />
        </g>
      </g>
      <circle cx="32" cy="32" r="29.2" fill="none" stroke="var(--ink)" strokeWidth="2.6" />
    </svg>
  )
}
