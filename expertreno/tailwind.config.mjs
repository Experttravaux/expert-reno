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
        // Vert forêt : couleur principale, reprise du logo
        // (en-têtes, sections sombres, titres).
        foret: {
          DEFAULT: '#163D2A',
          light: '#245A3D',
          dark: '#0E2C1E',
        },
        // Accent ocre / terracotta : à utiliser avec parcimonie (boutons, détails).
        // Pour un accent vert clair (proche du logo), remplacez par #6FB073.
        ocre: {
          DEFAULT: '#C8842D',
          light: '#DDA04F',
          dark: '#A66B1F',
        },
        sable: '#F4F1E9', // Neutre chaud très clair (fonds de section)
        brume: '#ECEFEA', // Gris-vert clair (séparateurs, fonds alternés)
        ardoise: '#566159', // Texte secondaire
        encre: '#19231D', // Texte principal
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
        card: '0 12px 40px -18px rgba(22, 61, 42, 0.25)',
      },
    },
  },
  plugins: [],
};
