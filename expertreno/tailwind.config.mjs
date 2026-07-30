/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      // ─────────────────────────────────────────────────────────────
      // 🎨 PALETTE — modifiez ces couleurs pour changer toute l'identité
      //    visuelle du site (utilisées partout via les classes Tailwind,
      //    ex. text-foret, bg-ocre, border-brume…).
      // ─────────────────────────────────────────────────────────────
      colors: {
        // ── Palette « Onyx & Laiton » — moderne, chic, haut de gamme ──
        // Onyx (noir chaud) : couleur principale (en-têtes, sections
        // sombres, titres). Remplace l'ancien vert.
        foret: {
          DEFAULT: '#1A1815',
          light: '#33302A',
          dark: '#0E0D0B',
        },
        // Laiton doré : accent chic, à utiliser avec parcimonie
        // (boutons, filets, détails, chiffres-clés).
        ocre: {
          DEFAULT: '#B4894E',
          light: '#CBA468',
          dark: '#8A6A38', // version foncée pour texte sur fond clair
        },
        sable: '#F7F4EF', // Ivoire chaud très clair (fonds de section)
        brume: '#ECE7DF', // Neutre chaud (séparateurs, fonds alternés)
        ardoise: '#6E685E', // Texte secondaire (taupe)
        encre: '#17150F', // Texte principal (encre presque noire)
      },
      // ─────────────────────────────────────────────────────────────
      // ✍️ TYPOGRAPHIE — les polices sont chargées dans BaseLayout.astro
      // ─────────────────────────────────────────────────────────────
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'], // Titres élégants
        sans: ['Inter', 'system-ui', 'sans-serif'], // Corps de texte lisible
      },
      maxWidth: {
        content: '1200px', // Largeur maximale du contenu centré
      },
      boxShadow: {
        card: '0 12px 40px -18px rgba(26, 24, 21, 0.28)',
      },
    },
  },
  plugins: [],
};
