import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// URL du site en production : utilisée pour générer le sitemap.xml et les balises
// canonical. Elle est lue depuis la variable d'environnement PUBLIC_SITE_URL
// (voir le fichier .env.example). Une valeur par défaut est fournie en secours.
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://www.expertreno.fr';

// ── Connexion Supabase (CRM) ──────────────────────────────────────────
// Clés PUBLIQUES (sans danger : destinées au navigateur, la base est
// protégée par RLS). On les injecte ici pour que la connexion fonctionne
// sur Vercel même si les variables d'environnement ne sont pas lues.
// Pour changer de projet : modifiez les 2 valeurs ci-dessous.
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || 'https://tscaqtzdtermwmrlfvbb.supabase.co';
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_oW_y-5diDDv3L4K8YYUwFw_2sIwviRh';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  // Intégrations : Tailwind CSS (styles) + Sitemap (génère sitemap-index.xml).
  // On exclut la page privée /admin (CRM) du sitemap public.
  integrations: [
    tailwind(),
    sitemap({ filter: (page) => !page.includes('/admin') && !page.includes('/espace-client') }),
  ],
  vite: {
    // Force l'injection des clés Supabase dans le code client (toutes les pages).
    define: {
      'import.meta.env.PUBLIC_SUPABASE_URL': JSON.stringify(SUPABASE_URL),
      'import.meta.env.PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(SUPABASE_ANON_KEY),
    },
  },
});
