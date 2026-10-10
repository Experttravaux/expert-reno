// Seed content for the practical-solutions library (10 sheets). Seeded
// unpublished: the founder reviews each sheet before it goes public.
// Arabic titles are drafts to be checked by a native speaker (darija).

import type { SolutionCategory, Trade } from '@thiqa/core';

export interface SolutionSeed {
  slug: string;
  category: SolutionCategory;
  title: { fr: string; ar: string };
  summary: string;
  steps: [string, string, string];
  materials: Array<[name: string, priceMad: number]>;
  level: 1 | 2 | 3;
  minutes: number;
  stop: string[];
  trade: Trade;
}

export const SOLUTIONS: SolutionSeed[] = [
  {
    slug: 'pression-eau-faible',
    category: 'eau',
    title: { fr: "L'eau sort faiblement à la douche", ar: 'الما كيخرج ضعيف فالدوش' },
    summary: 'Le plus souvent, du calcaire bouche le pommeau ou le filtre du mitigeur.',
    steps: [
      'Dévissez le pommeau et laissez-le tremper une nuit dans du vinaigre blanc.',
      'Nettoyez le petit filtre à l’entrée du flexible ou du mitigeur.',
      'Vérifiez que le robinet d’arrêt sous l’évier est ouvert à fond.',
    ],
    materials: [
      ['Vinaigre blanc 1 L', 15],
      ['Clé à molette', 60],
      ['Joints de flexible', 10],
    ],
    level: 1,
    minutes: 30,
    stop: [
      'La pression est faible à tous les robinets du logement.',
      'Le compteur tourne alors que tout est fermé.',
    ],
    trade: 'plombier',
  },
  {
    slug: 'chauffe-eau-peu-eau-chaude',
    category: 'eau',
    title: {
      fr: 'Le chauffe-eau donne peu d’eau chaude',
      ar: 'الشوفو كيعطي شوية ديال الما السخون',
    },
    summary: 'Thermostat trop bas ou calcaire au fond du ballon.',
    steps: [
      'Réglez le thermostat entre 55 et 60 °C.',
      'Vérifiez au tableau que le disjoncteur du chauffe-eau n’a pas sauté.',
      'Vidangez quelques litres par le groupe de sécurité pour chasser le calcaire.',
    ],
    materials: [
      ['Tournevis isolé', 30],
      ['Tuyau d’arrosage 5 m', 40],
    ],
    level: 2,
    minutes: 60,
    stop: [
      'Odeur de gaz près d’un chauffe-eau gaz : sortez et appelez.',
      'De l’eau coule en continu du groupe de sécurité.',
      'Le ballon a plus de 12 ans et fuit.',
    ],
    trade: 'plombier',
  },
  {
    slug: 'odeur-egout-salle-de-bain',
    category: 'eau',
    title: { fr: 'Ça sent l’égout dans la salle de bain', ar: 'كاينة ريحة الواد الحار فالحمام' },
    summary: 'Un siphon sec ou encrassé laisse remonter les odeurs.',
    steps: [
      'Faites couler l’eau dans les siphons peu utilisés (douche, bonde de sol).',
      'Démontez et nettoyez le siphon du lavabo au-dessus d’un seau.',
      'Refaites le joint silicone au pied des WC s’il est fendu.',
    ],
    materials: [
      ['Seau', 20],
      ['Gants', 15],
      ['Silicone sanitaire', 45],
    ],
    level: 1,
    minutes: 45,
    stop: [
      'L’odeur est dans plusieurs pièces ou l’eau refoule.',
      'Toutes les évacuations font des glouglous.',
    ],
    trade: 'plombier',
  },
  {
    slug: 'moisissure-coins',
    category: 'humidite',
    title: { fr: 'Des taches noires dans les coins', ar: 'بقع كحلة فالقنات' },
    summary: 'Condensation et manque d’aération, surtout en salle d’eau.',
    steps: [
      'Aérez 15 minutes après chaque douche, porte ouverte.',
      'Traitez les taches au nettoyant anti-moisissure, puis rincez.',
      'Après 48 h de séchage, repeignez avec une peinture pour pièces humides.',
    ],
    materials: [
      ['Nettoyant anti-moisissure', 60],
      ['Peinture pièces humides 2,5 L', 250],
      ['Extracteur d’air 100 mm', 350],
    ],
    level: 1,
    minutes: 240,
    stop: [
      'Le mur reste humide au toucher en permanence.',
      'Les taches reviennent en moins d’un mois.',
    ],
    trade: 'macon',
  },
  {
    slug: 'clim-refroidit-mal',
    category: 'clim',
    title: { fr: 'La clim refroidit mal', ar: 'الكليم ما كتبردش مزيان' },
    summary: 'Des filtres encrassés suffisent à faire perdre la moitié de la puissance.',
    steps: [
      'Coupez la clim, ouvrez le capot et sortez les filtres.',
      'Lavez-les à l’eau tiède et laissez sécher à l’ombre.',
      'Dépoussiérez la grille de l’unité extérieure si elle est accessible.',
    ],
    materials: [
      ['Brosse douce', 20],
      ['Nettoyant pour clim', 70],
    ],
    level: 1,
    minutes: 30,
    stop: [
      'Du givre se forme sur les tuyaux.',
      'De l’eau coule de l’unité intérieure.',
      'Odeur de brûlé.',
    ],
    trade: 'climaticien',
  },
  {
    slug: 'prise-qui-chauffe',
    category: 'electricite',
    title: { fr: 'Une prise ou un interrupteur chauffe', ar: 'بريز ولا سويتش كيسخن' },
    summary:
      'Ce n’est pas une réparation à faire soi-même : voici comment sécuriser en attendant l’électricien.',
    steps: [
      'Débranchez tout ce qui est branché sur la prise.',
      'Coupez au tableau le disjoncteur du circuit concerné.',
      'Signalez la prise pour que personne ne l’utilise, et appelez un électricien.',
    ],
    materials: [['Ruban de signalisation', 10]],
    level: 1,
    minutes: 5,
    stop: [
      'Traces noires ou odeur de plastique brûlé.',
      'Le disjoncteur saute de façon répétée.',
      'La prise est fissurée ou bouge dans le mur.',
    ],
    trade: 'electricien',
  },
  {
    slug: 'fenetre-laisse-passer-air',
    category: 'fenetres',
    title: { fr: 'La fenêtre laisse passer l’air', ar: 'الشرجم كيدوز منو الهوا' },
    summary: 'Joint usé ou ouvrant mal réglé.',
    steps: [
      'Coincez une feuille de papier fenêtre fermée : si elle glisse, le joint est usé.',
      'Remplacez le joint par un joint mousse adhésif.',
      'Réglez les galets ou gonds pour que l’ouvrant plaque bien.',
    ],
    materials: [
      ['Joint mousse adhésif 10 m', 40],
      ['Clés Allen', 35],
    ],
    level: 1,
    minutes: 45,
    stop: [
      'Le châssis est déformé ou la vitre fissurée.',
      'De la buée apparaît entre les deux vitres.',
    ],
    trade: 'menuisier',
  },
  {
    slug: 'robinet-chasse-qui-fuit',
    category: 'eau',
    title: { fr: 'Le robinet goutte, la chasse d’eau coule', ar: 'الروبيني كيقطر والشاص كيسيل' },
    summary: 'Une fuite de chasse d’eau peut coûter plusieurs centaines de dirhams par an.',
    steps: [
      'Fermez l’arrivée d’eau sous le lavabo ou derrière les WC.',
      'Robinet : remplacez la cartouche ou le joint.',
      'Chasse : réglez le flotteur ou changez le joint du clapet.',
    ],
    materials: [
      ['Cartouche de mitigeur', 80],
      ['Joint de clapet', 25],
      ['Clé à molette', 60],
    ],
    level: 2,
    minutes: 45,
    stop: ['La fuite vient du tuyau dans le mur.', 'Le robinet d’arrêt ne ferme plus.'],
    trade: 'plombier',
  },
  {
    slug: 'infiltration-terrasse-pluie',
    category: 'humidite',
    title: {
      fr: 'De l’eau entre par le plafond après la pluie',
      ar: 'الما كيدخل من السقف من بعد الشتا',
    },
    summary: 'Ce qu’il faut faire tout de suite, avant le passage de l’étancheur.',
    steps: [
      'Dégagez les évacuations d’eau de la terrasse (feuilles, sacs, terre).',
      'Repérez les fissures et décollements, prenez-les en photo.',
      'Posez une bâche lestée sur la zone en attendant la réparation.',
    ],
    materials: [
      ['Bâche 4 × 5 m', 120],
      ['Mastic d’étanchéité provisoire', 90],
    ],
    level: 2,
    minutes: 60,
    stop: [
      'Le plafond gonfle ou s’affaisse.',
      'L’eau coule près d’un luminaire ou d’une prise : coupez le courant.',
    ],
    trade: 'etancheite',
  },
  {
    slug: 'peinture-qui-cloque',
    category: 'peinture',
    title: { fr: 'La peinture fait des cloques', ar: 'الصباغة كتنفخ' },
    summary: 'Souvent une peinture posée sur un support humide ou poussiéreux.',
    steps: [
      'Grattez les cloques et laissez le mur sécher.',
      'Poncez, rebouchez et dépoussiérez.',
      'Passez une sous-couche, puis deux couches de peinture adaptée.',
    ],
    materials: [
      ['Grattoir', 25],
      ['Enduit de rebouchage', 50],
      ['Sous-couche 2,5 L', 150],
    ],
    level: 2,
    minutes: 480,
    stop: [
      'Le mur est humide derrière : c’est un problème d’humidité, pas de peinture.',
      'Les cloques reviennent en quelques semaines.',
    ],
    trade: 'peintre',
  },
];
