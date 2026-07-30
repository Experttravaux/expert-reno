import { defineCollection, z } from 'astro:content';

// ═══════════════════════════════════════════════════════════════════════════
//  SCHÉMAS DE CONTENU
//  Ces "schémas" décrivent les champs attendus dans les fichiers Markdown
//  des dossiers src/content/services/ et src/content/projets/.
//  Si vous ajoutez un fichier, respectez les mêmes champs (en haut, entre ---).
// ═══════════════════════════════════════════════════════════════════════════

// ─── SERVICES ────────────────────────────────────────────────────────────────
const services = defineCollection({
  type: 'content',
  schema: z.object({
    titre: z.string(), // Titre du service
    resume: z.string(), // Phrase courte affichée sur les cartes
    // Marque associée : 'reno' (conseil/AMO) ou 'travaux' (entreprise générale)
    marque: z.enum(['reno', 'travaux']),
    // Ordre d'affichage (plus petit = affiché en premier)
    ordre: z.number().default(99),
    // Liste des bénéfices / prestations (puces)
    points: z.array(z.string()).default([]),
    // SEO propre à la page du service
    metaTitle: z.string(),
    metaDescription: z.string(),
    // Mettre à true pour mettre le service en avant (carte plus grande)
    vedette: z.boolean().default(false),
  }),
});

// ─── PROJETS / RÉALISATIONS ──────────────────────────────────────────────────
const projets = defineCollection({
  type: 'content',
  schema: z.object({
    titre: z.string(),
    resume: z.string(),
    // Liste des travaux réalisés (puces)
    travaux: z.array(z.string()),
    // Budget travaux (texte libre, ex. "76 000 €")
    budget: z.string(),
    // Budget ameublement / mobilier, optionnel (ex. "8 500 €")
    ameublement: z.string().optional(),
    // Délais (texte libre)
    delaiTravaux: z.string(),
    delaiPrepa: z.string().optional(),
    ordre: z.number().default(99),
    // Image de couverture (chemin dans /public, ex. "/images/projets/duplex-1.jpg")
    couverture: z.string().optional(),
    // Galerie photo : liste d'images avec leur texte alternatif (alt) pour le SEO/accessibilité
    galerie: z
      .array(
        z.object({
          src: z.string(), // chemin de l'image dans /public/images/projets/
          alt: z.string(), // description de l'image (obligatoire)
        })
      )
      .default([]),
  }),
});

export const collections = { services, projets };
