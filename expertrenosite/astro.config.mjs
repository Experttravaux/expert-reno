import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// URL du site en production : utilisée pour générer le sitemap.xml et les balises
// canonical. Elle est lue depuis la variable d'environnement PUBLIC_SITE_URL
// (voir le fichier .env.example). Une valeur par défaut est fournie en secours.
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://www.expertreno.fr';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  // Intégrations : Tailwind CSS (styles) + Sitemap (génère sitemap-index.xml).
  // On exclut la page privée /admin (CRM) du sitemap public.
  integrations: [
    tailwind(),
    sitemap({ filter: (page) => !page.includes('/admin') && !page.includes('/espace-client') }),
  ],
});
