// ═══════════════════════════════════════════════════════════════════════════
//  FICHIER DE CONTENU CENTRAL — Expert Réno & Expert Travaux
//
//  ✏️  C'EST LE FICHIER À MODIFIER EN PRIORITÉ.
//  Vous pouvez éditer ici, sans toucher au code des composants :
//   • les coordonnées (téléphone, email, WhatsApp)
//   • les liens de réseaux sociaux
//   • les chiffres-clés affichés sur l'accueil
//   • les textes des principales sections
//
//  Règle simple : ne changez que le texte entre les guillemets " ".
// ═══════════════════════════════════════════════════════════════════════════

// ─── IDENTITÉ DES DEUX MARQUES ───────────────────────────────────────────────
// Le site réunit deux marques complémentaires, portées par la même personne :
//   • Expert Réno    → conseil, maîtrise d'ouvrage, optimisation, aides
//   • Expert Travaux → entreprise générale de bâtiment, tous corps d'état
export const marques = {
  reno: {
    nom: 'Expert Réno',
    role: 'Conseil & maîtrise d’ouvrage',
    accroche:
      'Le conseil qui sécurise votre projet : optimisation des devis, plans, sélection des entreprises et obtention des aides.',
  },
  travaux: {
    nom: 'Expert Travaux',
    role: 'Entreprise générale de bâtiment — tous corps d’état',
    accroche:
      'La réalisation, de A à Z : un interlocuteur unique qui pilote l’ensemble des corps d’état et vous livre clé en main.',
  },
};

// ─── INFOS GÉNÉRALES ─────────────────────────────────────────────────────────
export const site = {
  // Marque "ombrelle" affichée dans le logo principal (le domaine est expertreno.fr)
  nom: 'Expert Réno',
  // Baseline courte affichée sous le logo et dans les partages sociaux
  baseline: 'Conseil, maîtrise d’ouvrage & entreprise générale tous corps d’état',
  // Années d'expérience (uniformisé partout sur le site)
  experience: '25 ans',
  // Zones d'intervention (la première est mise en avant pour le SEO local)
  zones: ['Toulouse', 'Bordeaux', 'Toute la France à distance'],
};

// ─── COORDONNÉES ─────────────────────────────────────────────────────────────
export const contact = {
  // Téléphone : version "machine" (pour les liens) et version "affichée"
  telephone: '+33781844103',
  telephoneAffiche: '07 81 84 41 03',
  // Email de contact (remplacez par votre adresse définitive si besoin)
  email: 'contact@expertreno.fr',
  // WhatsApp : numéro au format international sans espaces ni "+"
  whatsapp: '33781844103',
  // Ville principale (affichée dans le pied de page et les données SEO)
  ville: 'Toulouse',
  region: 'Occitanie',
  pays: 'France',
};

// ─── RÉSEAUX SOCIAUX (liens réels) ───────────────────────────────────────────
export const reseaux = {
  instagram: 'https://www.instagram.com/conseiltravaux/',
  linkedin: 'https://www.linkedin.com/in/expert-réno-93a56a339',
  twitter: 'https://x.com/Expertreno31',
  // Lien WhatsApp cliquable (ouvre une conversation pré-remplie)
  whatsapp: 'https://wa.me/33781844103',
};

// ─── NAVIGATION PRINCIPALE ───────────────────────────────────────────────────
// Modifiez les libellés ou l'ordre ici ; les liens doivent correspondre aux pages.
export const navigation = [
  { libelle: 'Accueil', lien: '/' },
  { libelle: 'Services', lien: '/services' },
  { libelle: 'Projets', lien: '/projets' },
  { libelle: 'Professionnels', lien: '/professionnels' },
  { libelle: 'À propos', lien: '/a-propos' },
  { libelle: 'Contact', lien: '/contact' },
];

// ─── CHIFFRES-CLÉS DU SECTEUR (présentés comme problèmes que nous résolvons) ──
// Affichés sur la page d'accueil. Éditez valeur / libellé librement.
export const chiffresCles = [
  {
    valeur: '50 %',
    label: 'des chantiers dépassent le budget prévu',
    solution: 'Nous verrouillons le budget dès le départ et le suivons à l’euro près.',
  },
  {
    valeur: '80 %',
    label: 'des projets de rénovation génèrent un litige',
    solution: 'Un interlocuteur unique et des entreprises sélectionnées : zéro zone grise.',
  },
  {
    valeur: '+60 %',
    label: 'de hausse des coûts de construction en 10 ans',
    solution: 'Devis optimisés et aides mobilisées pour maîtriser la facture.',
  },
  {
    valeur: '3 à 6 mois',
    label: 'de retard moyen sur un chantier',
    solution: 'Un planning piloté et coordonné, tenu jusqu’à la livraison.',
  },
];

// ─── PREUVES / ENGAGEMENTS (réassurance affichée sur l'accueil) ──────────────
export const engagements = [
  {
    titre: '25 ans tous corps d’état',
    texte:
      'Un quart de siècle sur le terrain, du gros œuvre aux finitions : nous connaissons les bons artisans et les vrais prix.',
  },
  {
    titre: 'Interlocuteur unique',
    texte:
      'Un seul contact responsable de tout le chantier : vous ne courez plus après dix intervenants.',
  },
  {
    titre: 'Budget & délais maîtrisés',
    texte:
      'Devis optimisés, planning piloté, suivi rigoureux : pas de mauvaise surprise en cours de route.',
  },
  {
    titre: 'Assurances & syndics',
    texte:
      'Habitué à travailler avec les experts d’assurance et les syndics de copropriété, dossiers et devis conformes.',
  },
];
