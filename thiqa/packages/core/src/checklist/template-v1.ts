// Checklist template v1 — "Contrôle pré-achat" & "Audit locatif" (§4).
// Source of truth for the seed; once published, a version is immutable:
// any change ships as v2 and reports keep the version they were built with.

import type { PropertyType, Purpose, Severity } from '../domain';
import type { BlockCode, ChecklistItem, ChecklistTemplate, SeverityRule } from './schema';
import { catalogEntry } from './works-catalog';

interface Opts {
  help?: string;
  required?: boolean;
  photos?: number;
  room?: boolean;
  deferred?: boolean;
  /** Catalog code, optionally with a per-item estimate overriding the catalog range. */
  works?: string | [code: string, min: number, max: number];
  types?: PropertyType[];
  purposes?: Purpose[];
}

const APPART: PropertyType[] = ['studio', 'appartement'];
const INDIVIDUAL: PropertyType[] = ['maison', 'villa', 'riad'];
const RENTAL: Purpose[] = ['location_courte_duree', 'location_longue_duree'];
const LCD: Purpose[] = ['location_courte_duree'];
const LLD: Purpose[] = ['location_longue_duree'];

function base(
  code: string,
  label: string,
  type: ChecklistItem['type'],
  rules: SeverityRule[],
  o: Opts,
): ChecklistItem {
  const item: ChecklistItem = {
    code,
    label_i18n: { fr: label },
    type,
    required: o.required ?? true,
    photo_min: o.photos ?? 0,
    scope: o.room ? 'room' : 'property',
    severity_rules: rules,
    applies_to: {},
  };
  if (o.help) item.help_i18n = { fr: o.help };
  if (o.deferred) item.deferred = true;
  if (o.types) item.applies_to.property_types = o.types;
  if (o.purposes) item.applies_to.purposes = o.purposes;
  if (o.works) {
    const [catalog_code, min, max] = typeof o.works === 'string' ? [o.works] : o.works;
    const entry = catalogEntry(catalog_code);
    item.works_hint = {
      catalog_code,
      min_mad: min ?? entry.min_mad,
      max_mad: max ?? entry.max_mad,
    };
  }
  return item;
}

/** Yes/no question where "yes" is a defect. */
const defect = (code: string, label: string, sev: Severity, o: Opts = {}) =>
  base(code, label, 'boolean', [{ when: { op: 'eq', value: true }, severity: sev }], o);

/** Yes/no question where "no" is a defect. */
const check = (code: string, label: string, sev: Severity, o: Opts = {}) =>
  base(code, label, 'boolean', [{ when: { op: 'eq', value: false }, severity: sev }], o);

type Opt = [value: string, label: string, severity?: Severity];
function select(code: string, label: string, options: Opt[], o: Opts = {}): ChecklistItem {
  const rules: SeverityRule[] = options
    .filter(([, , sev]) => sev && sev !== 'green')
    .map(([value, , sev]) => ({ when: { op: 'eq', value }, severity: sev as Severity }));
  const item = base(code, label, 'select', rules, o);
  item.options = options.map(([value, fr]) => ({ value, label_i18n: { fr } }));
  return item;
}

function measure(
  code: string,
  label: string,
  m: NonNullable<ChecklistItem['measure']>,
  rules: SeverityRule[] = [],
  o: Opts = {},
): ChecklistItem {
  const item = base(code, label, 'measure', rules, o);
  item.measure = m;
  return item;
}

const num = (code: string, label: string, o: Opts = {}) => base(code, label, 'number', [], o);
const text = (code: string, label: string, o: Opts = {}) =>
  base(code, label, 'text', [], { required: false, ...o });
const photo = (code: string, label: string, n: number, o: Opts = {}) =>
  base(code, label, 'photo', [], { photos: n, ...o });

const gt = (value: number, severity: Severity): SeverityRule => ({
  when: { op: 'gt', value },
  severity,
});
const gte = (value: number, severity: Severity): SeverityRule => ({
  when: { op: 'gte', value },
  severity,
});
const lt = (value: number, severity: Severity): SeverityRule => ({
  when: { op: 'lt', value },
  severity,
});
const lte = (value: number, severity: Severity): SeverityRule => ({
  when: { op: 'lte', value },
  severity,
});

// ---------------------------------------------------------------------------
// 1. Administratif
// ---------------------------------------------------------------------------
const ADM: ChecklistItem[] = [
  select(
    'ADM_STATUT_FONCIER',
    'Statut foncier du bien',
    [
      ['titre', 'Titré (titre foncier)'],
      ['requisition', "Réquisition d'immatriculation en cours", 'orange'],
      ['melkia', 'Melkia / non immatriculé', 'red'],
      ['inconnu', 'Non communiqué', 'red'],
    ],
    {
      works: 'ADM_REGULARISATION',
      help: 'Demander le certificat de propriété de la Conservation foncière.',
    },
  ),
  check(
    'ADM_TF_CONCORDANCE',
    'Référence du titre foncier concordante avec le bien visité',
    'blocking',
    {
      help: 'Comparer adresse, étage, numéro de lot et superficie.',
    },
  ),
  check('ADM_CERTIFICAT_RECENT', 'Certificat de propriété de moins de 3 mois présenté', 'orange'),
  defect('ADM_HYPOTHEQUE', 'Hypothèque, saisie ou prénotation inscrite au titre', 'red'),
  defect('ADM_INDIVISION', 'Indivision avec co-indivisaires non tous vendeurs', 'blocking'),
  defect('ADM_LITIGE', 'Litige connu (voisinage, procédure, occupant sans titre)', 'red'),
  select(
    'ADM_CONFORMITE_PLAN',
    'Conformité au plan autorisé',
    [
      ['conforme', 'Conforme'],
      ['ecarts_mineurs', 'Écarts mineurs (cloisons)', 'orange'],
      ['extension_non_autorisee', 'Extension / surélévation non autorisée', 'red'],
      ['plan_non_fourni', 'Plan non fourni', 'orange'],
    ],
    { works: 'ADM_REGULARISATION' },
  ),
  select('ADM_PERMIS_HABITER', "Permis d'habiter / certificat de conformité", [
    ['fourni', 'Fourni'],
    ['en_cours', 'En cours', 'orange'],
    ['absent', 'Absent', 'red'],
    ['non_applicable', 'Non applicable (construction ancienne)'],
  ]),
  measure(
    'ADM_ECART_SURFACE',
    'Écart entre surface mesurée et surface déclarée',
    { unit: '%', max_ok: 5, input_min: 0, input_max: 100 },
    [gt(10, 'red'), gt(5, 'orange')],
  ),
  select(
    'ADM_SYNDIC',
    'Gestion de la copropriété',
    [
      ['syndic_professionnel', 'Syndic professionnel'],
      ['syndic_benevole', 'Syndic bénévole'],
      ['aucun', 'Aucun syndic (loi 18-00 non appliquée)', 'orange'],
    ],
    { types: [...APPART, 'local'] },
  ),
  num('ADM_CHARGES_MENSUELLES', 'Charges de copropriété (MAD / mois)', {
    required: false,
    types: [...APPART, 'local'],
  }),
  defect('ADM_CHARGES_IMPAYEES', 'Charges de copropriété impayées par le vendeur', 'red', {
    types: [...APPART, 'local'],
    works: 'ADM_COPRO_ARRIERES',
  }),
  check('ADM_PV_AG', 'PV des 3 dernières assemblées générales consultés', 'orange', {
    types: [...APPART, 'local'],
  }),
  defect(
    'ADM_TRAVAUX_VOTES',
    'Travaux importants votés ou envisagés par la copropriété',
    'orange',
    { types: [...APPART, 'local'] },
  ),
  defect('ADM_TAXES_IMPAYEES', 'Taxe de services communaux / habitation impayée', 'orange'),
  defect('ADM_SERVITUDE', 'Servitude identifiée (passage, vue, réseaux)', 'orange'),
  photo('ADM_PHOTOS_DOCUMENTS', 'Photos des documents consultés', 1, { required: false }),
];

// ---------------------------------------------------------------------------
// 2. Structure
// ---------------------------------------------------------------------------
const STR: ChecklistItem[] = [
  select('STR_TYPE_STRUCTURE', 'Type de structure', [
    ['beton_arme', 'Béton armé (poteaux-poutres)'],
    ['maconnerie_porteuse', 'Maçonnerie porteuse'],
    ['terre_pise', 'Terre / pisé', 'orange'],
    ['mixte', 'Mixte'],
    ['inconnu', 'Non identifiable'],
  ]),
  check(
    'STR_CHAINAGES',
    'Chaînages / poteaux visibles (règlement parasismique RPS 2000)',
    'orange',
    {
      help: 'Marrakech est en zone sismique : repérer chaînages horizontaux et verticaux.',
    },
  ),
  select(
    'STR_FISSURES_TYPE',
    'Fissures observées (type le plus défavorable)',
    [
      ['aucune', 'Aucune'],
      ['faiencage', 'Faïençage d’enduit'],
      ['capillaire', 'Capillaires < 0,2 mm'],
      ['fine', 'Fines 0,2–2 mm', 'orange'],
      ['structurelle', 'Traversantes / en escalier / > 2 mm', 'red'],
    ],
    { photos: 0, works: 'STR_FISSURE_REPRISE' },
  ),
  measure(
    'STR_FISSURE_LARGEUR',
    'Largeur de la fissure la plus ouverte',
    { unit: 'mm', max_ok: 0.2, input_min: 0, input_max: 50 },
    [gte(2, 'red'), gt(0.2, 'orange')],
    {
      required: false,
      photos: 2,
      works: 'STR_FISSURE_REPRISE',
      help: 'Mesurer au fissuromètre, photo avec la jauge.',
    },
  ),
  defect(
    'STR_FISSURES_EVOLUTIVES',
    'Fissures évolutives (rebouchage récent ré-ouvert, témoins cassés)',
    'red',
    {
      photos: 1,
      works: 'STR_ETUDE_BET',
    },
  ),
  defect('STR_AFFAISSEMENT', 'Affaissement ou déformation de plancher', 'blocking', {
    photos: 2,
    works: 'STR_RENFORCEMENT',
  }),
  defect('STR_FLECHE', 'Flèche visible de poutres ou linteaux', 'red', {
    photos: 1,
    works: 'STR_ETUDE_BET',
  }),
  defect('STR_ACIERS_APPARENTS', 'Aciers apparents / béton éclaté (corrosion)', 'red', {
    photos: 2,
    works: 'STR_BETON_REPARATION',
  }),
  defect('STR_MURS_PORTEURS_MODIFIES', 'Mur porteur supprimé ou percé sans étude', 'blocking', {
    photos: 1,
    works: 'STR_RENFORCEMENT',
  }),
  defect(
    'STR_TASSEMENT',
    'Signes de tassement différentiel (portes qui frottent, sols en pente)',
    'red',
    { works: 'STR_ETUDE_BET' },
  ),
  defect('STR_PLANCHER_SOUPLE', 'Plancher souple / vibrations anormales', 'orange', {
    works: 'STR_ETUDE_BET',
  }),
  select(
    'STR_BALCON',
    'État des balcons / terrasses',
    [
      ['sans_objet', 'Sans objet'],
      ['bon', 'Bon'],
      ['surface', 'Dégradations de surface', 'orange'],
      ['aciers', 'Aciers apparents / épaufrures', 'red'],
      ['dangereux', 'Dangereux (fissure d’encastrement)', 'blocking'],
    ],
    { photos: 1, works: 'STR_BALCON_REPRISE' },
  ),
  measure(
    'STR_GARDE_CORPS_HAUTEUR',
    'Hauteur des garde-corps',
    { unit: 'cm', min_ok: 100, input_min: 0, input_max: 200 },
    [lt(90, 'red'), lt(100, 'orange')],
    { required: false, works: ['STR_GARDE_CORPS', 2000, 10000] },
  ),
  defect('STR_TERRASSE_DESORDRES', 'Désordres structurels de la toiture-terrasse', 'red', {
    works: 'STR_ETUDE_BET',
  }),
  select(
    'STR_ESCALIER',
    'État des escaliers',
    [
      ['sans_objet', 'Sans objet'],
      ['bon', 'Bon'],
      ['usure', 'Usure / nez de marche abîmés', 'orange'],
      ['dangereux', 'Dangereux', 'red'],
    ],
    { works: 'STR_ESCALIER_REPRISE' },
  ),
  select(
    'STR_FACADE',
    'État des façades',
    [
      ['bon', 'Bon'],
      ['entretien', 'Entretien à prévoir', 'orange'],
      ['degradee', 'Dégradée (chutes d’enduit)', 'red'],
    ],
    { photos: 2, works: 'STR_FACADE_RAVALEMENT' },
  ),
  defect('STR_SURELEVATION', 'Surélévation ou extension visible', 'orange', { photos: 1 }),
  select(
    'STR_PARTIES_COMMUNES',
    'État des parties communes',
    [
      ['bon', 'Bon'],
      ['moyen', 'Moyen', 'orange'],
      ['mauvais', 'Mauvais', 'red'],
    ],
    { types: APPART, photos: 1 },
  ),
  photo('STR_PHOTOS_ENSEMBLE', "Vues d'ensemble des façades et de l'immeuble", 2),
];

// ---------------------------------------------------------------------------
// 3. Humidité & étanchéité
// ---------------------------------------------------------------------------
const HUM: ChecklistItem[] = [
  measure(
    'HUM_HUMIDIMETRE',
    'Humidité des murs (humidimètre, point le plus humide)',
    { unit: '%', max_ok: 15, input_min: 0, input_max: 100 },
    [gt(25, 'red'), gt(15, 'orange')],
    {
      room: true,
      works: 'HUM_TRAITEMENT_LOCAL',
      help: 'Mesurer en pied de mur, en angle et sous fenêtre.',
    },
  ),
  defect('HUM_TRACES', "Traces d'humidité / auréoles", 'orange', {
    room: true,
    photos: 1,
    works: 'HUM_TRAITEMENT_LOCAL',
  }),
  defect('HUM_MOISISSURES', 'Moisissures visibles', 'orange', {
    room: true,
    photos: 1,
    works: 'HUM_TRAITEMENT_LOCAL',
  }),
  defect('HUM_SALPETRE', 'Salpêtre / efflorescences en pied de mur', 'orange', {
    photos: 1,
    works: 'HUM_REMONTEES_CAPILLAIRES',
  }),
  defect('HUM_REMONTEES_CAPILLAIRES', 'Remontées capillaires', 'red', {
    photos: 1,
    works: ['HUM_REMONTEES_CAPILLAIRES', 8000, 30000],
  }),
  defect('HUM_INFILTRATION_FACADE', 'Infiltrations par la façade', 'red', {
    photos: 1,
    works: 'HUM_INFILTRATION_FACADE',
  }),
  defect('HUM_INFILTRATION_TOITURE', 'Infiltrations par la toiture / terrasse', 'red', {
    photos: 1,
    works: ['HUM_ETANCHEITE_TERRASSE', 15000, 50000],
  }),
  select(
    'HUM_ETANCHEITE_TERRASSE',
    "État de l'étanchéité de la terrasse",
    [
      ['sans_objet', 'Sans objet (étage intermédiaire)'],
      ['recente', 'Récente, bon état'],
      ['ancienne', 'Ancienne mais saine', 'orange'],
      ['degradee', 'Dégradée (cloques, fissures)', 'red'],
      ['non_accessible', 'Non accessible', 'orange'],
    ],
    { photos: 1, works: ['HUM_ETANCHEITE_TERRASSE', 15000, 50000] },
  ),
  defect('HUM_RELEVES_ACROTERES', "Relevés d'étanchéité / acrotères fissurés", 'orange', {
    required: false,
    works: 'HUM_ETANCHEITE_TERRASSE',
  }),
  select(
    'HUM_EVAC_PLUVIALES',
    'Évacuations des eaux pluviales',
    [
      ['ok', 'Fonctionnelles'],
      ['obstruees', 'Obstruées', 'orange'],
      ['absentes', 'Absentes / insuffisantes', 'red'],
    ],
    { works: 'HUM_EVAC_PLUVIALES' },
  ),
  check('HUM_VENTILATION_SDB', "Ventilation des salles d'eau (extracteur ou fenêtre)", 'orange', {
    works: 'HUM_VENTILATION',
  }),
  check('HUM_VENTILATION_CUISINE', 'Ventilation de la cuisine', 'orange', {
    works: 'HUM_VENTILATION',
  }),
  defect('HUM_CONDENSATION', 'Condensation / ponts thermiques', 'orange'),
  defect('HUM_DEGAT_VOISIN', "Traces de dégât des eaux provenant d'un voisin", 'orange', {
    types: APPART,
  }),
  defect('HUM_SOUS_SOL', 'Sous-sol ou cave humide', 'orange', {
    types: INDIVIDUAL,
    required: false,
  }),
  defect(
    'HUM_PEINTURE_RECENTE',
    'Peinture récente localisée pouvant masquer un désordre',
    'orange',
    {
      help: 'Contrôler à l’humidimètre toute zone repeinte récemment.',
    },
  ),
];

// ---------------------------------------------------------------------------
// 4. Électricité
// ---------------------------------------------------------------------------
const ELE: ChecklistItem[] = [
  select(
    'ELE_TABLEAU_TYPE',
    'Type de tableau électrique',
    [
      ['disjoncteurs', 'Disjoncteurs modulaires'],
      ['mixte', 'Mixte', 'orange'],
      ['fusibles', 'Fusibles / porcelaine', 'red'],
    ],
    { works: 'ELE_TABLEAU' },
  ),
  select(
    'ELE_TABLEAU_ETAT',
    'État du tableau électrique',
    [
      ['bon', 'Bon'],
      ['vetuste', 'Vétuste', 'orange'],
      ['dangereux', 'Dangereux (traces de chauffe, pièces nues)', 'blocking'],
    ],
    { photos: 2, works: 'ELE_TABLEAU' },
  ),
  check('ELE_DIFFERENTIEL', 'Présence d’un interrupteur différentiel 30 mA', 'red', {
    works: 'ELE_DIFFERENTIEL',
  }),
  check('ELE_DIFFERENTIEL_TEST', 'Test du différentiel (bouton test) concluant', 'red', {
    works: 'ELE_DIFFERENTIEL',
  }),
  check('ELE_TERRE', 'Prise de terre présente', 'red', { works: 'ELE_TERRE' }),
  measure(
    'ELE_TERRE_RESISTANCE',
    'Résistance de la prise de terre',
    { unit: 'Ω', max_ok: 100, input_min: 0, input_max: 5000 },
    [gt(100, 'red')],
    { required: false, works: 'ELE_TERRE' },
  ),
  select(
    'ELE_SECTION_CABLES',
    'Section des conducteurs / calibre des protections',
    [
      ['conforme', 'Conforme'],
      ['sous_dimensionne', 'Sous-dimensionné', 'red'],
      ['non_verifiable', 'Non vérifiable', 'orange'],
    ],
    { works: 'ELE_MISE_NORMES_PARTIELLE' },
  ),
  defect('ELE_CONDUCTEURS_NUS', 'Conducteurs dénudés / connexions accessibles', 'blocking', {
    photos: 1,
    works: 'ELE_SECURISATION',
  }),
  defect('ELE_CABLAGE_APPARENT', 'Câblage apparent non protégé', 'orange', {
    works: 'ELE_MISE_NORMES_PARTIELLE',
  }),
  measure(
    'ELE_PRISES_DEFECTUEUSES',
    'Prises défectueuses au testeur (nombre)',
    { unit: 'u', max_ok: 0, input_min: 0, input_max: 30 },
    [gte(3, 'red'), gte(1, 'orange')],
    {
      room: true,
      works: ['ELE_PRISE', 300, 1500],
      help: 'Tester chaque prise : phase, neutre, terre.',
    },
  ),
  check('ELE_PRISES_TERRE', 'Toutes les prises de la pièce sont reliées à la terre', 'orange', {
    room: true,
    works: 'ELE_PRISE',
  }),
  check('ELE_POINTS_LUMINEUX', 'Points lumineux fonctionnels', 'orange', { room: true }),
  defect('ELE_APPAREILLAGE_ABIME', 'Appareillages cassés ou ayant chauffé', 'orange', {
    works: 'ELE_PRISE',
  }),
  check('ELE_VOLUMES_SDB', "Volumes de sécurité respectés en salle d'eau", 'red', {
    works: 'ELE_MISE_NORMES_PARTIELLE',
  }),
  measure(
    'ELE_PUISSANCE_SOUSCRITE',
    'Puissance souscrite',
    { unit: 'kVA', min_ok: 6, input_min: 0, input_max: 100 },
    [lt(3, 'red'), lt(6, 'orange')],
    { required: false },
  ),
  check('ELE_COMPTEUR_INDIVIDUEL', 'Compteur électrique individuel (Régie / ONEE)', 'orange'),
  defect('ELE_RACCORDEMENT_ILLICITE', 'Raccordement partagé ou illicite', 'red'),
  check('ELE_EXTERIEUR_ETANCHE', 'Équipements extérieurs étanches (luminaires, prises)', 'orange', {
    types: INDIVIDUAL,
  }),
  select(
    'ELE_MISE_NORMES',
    'Mise aux normes électrique estimée',
    [
      ['aucune', 'Aucune'],
      ['partielle', 'Partielle', 'orange'],
      ['complete', 'Rénovation complète', 'red'],
    ],
    { works: ['ELE_RENOVATION_COMPLETE', 15000, 45000] },
  ),
];

// ---------------------------------------------------------------------------
// 5. Plomberie
// ---------------------------------------------------------------------------
const PLB: ChecklistItem[] = [
  measure(
    'PLB_PRESSION',
    "Pression d'eau (manomètre)",
    { unit: 'bar', min_ok: 2, max_ok: 4, input_min: 0, input_max: 16 },
    [lt(1, 'red'), gt(6, 'red')],
    { works: 'PLB_REDUCTEUR_PRESSION' },
  ),
  check('PLB_DEBIT', 'Débit suffisant à tous les points d’eau', 'orange'),
  select(
    'PLB_CHAUFFE_EAU_TYPE',
    'Type de production d’eau chaude',
    [
      ['electrique', 'Ballon électrique'],
      ['gaz', 'Chauffe-eau gaz'],
      ['solaire', 'Solaire'],
      ['thermodynamique', 'Thermodynamique'],
      ['aucun', 'Aucune', 'orange'],
    ],
    { photos: 1, works: 'PLB_CHAUFFE_EAU' },
  ),
  measure(
    'PLB_CHAUFFE_EAU_AGE',
    'Âge du chauffe-eau',
    { unit: 'ans', max_ok: 10, input_min: 0, input_max: 60 },
    [gt(15, 'red')],
    { required: false, works: 'PLB_CHAUFFE_EAU' },
  ),
  defect(
    'PLB_GAZ_PIECE_NON_VENTILEE',
    'Chauffe-eau gaz dans une pièce non ventilée ou salle de bain',
    'blocking',
    {
      works: 'PLB_CHAUFFE_EAU_GAZ_DEPLACEMENT',
      help: 'Risque d’intoxication au monoxyde de carbone.',
    },
  ),
  check('PLB_GROUPE_SECURITE', 'Groupe de sécurité sur ballon électrique', 'orange', {
    required: false,
  }),
  defect('PLB_FUITES', 'Fuites visibles', 'red', { photos: 1, works: 'PLB_RECHERCHE_FUITE' }),
  defect('PLB_COMPTEUR_TOURNE', "Compteur d'eau tournant robinets fermés", 'red', {
    works: 'PLB_RECHERCHE_FUITE',
  }),
  select(
    'PLB_EVACUATIONS',
    'Évacuations des eaux usées',
    [
      ['ok', 'Fluides'],
      ['lentes', 'Lentes', 'orange'],
      ['bouchees', 'Bouchées / refoulements', 'red'],
    ],
    { works: 'PLB_EVACUATIONS' },
  ),
  defect('PLB_ODEURS', "Odeurs d'égout (siphons, ventilation de chute)", 'orange', {
    works: 'PLB_EVACUATIONS',
  }),
  select(
    'PLB_SANITAIRES',
    'État des sanitaires',
    [
      ['bon', 'Bon'],
      ['usure', 'Usure', 'orange'],
      ['a_remplacer', 'À remplacer', 'red'],
    ],
    { works: 'PLB_SANITAIRES' },
  ),
  defect('PLB_JOINTS', 'Joints sanitaires dégradés', 'orange', { works: 'PLB_JOINTS' }),
  select(
    'PLB_CANALISATIONS',
    'Matériau des canalisations visibles',
    [
      ['cuivre', 'Cuivre'],
      ['per_multicouche', 'PER / multicouche'],
      ['pvc', 'PVC pression'],
      ['galvanise', 'Acier galvanisé', 'orange'],
      ['plomb', 'Plomb', 'red'],
      ['non_visible', 'Non visible'],
    ],
    { works: 'PLB_RESEAU_REPRISE' },
  ),
  select(
    'PLB_QUALITE_EAU',
    "Aspect de l'eau au robinet",
    [
      ['claire', 'Claire'],
      ['trouble', 'Trouble', 'orange'],
      ['coloree', 'Colorée / dépôts', 'red'],
    ],
    { works: 'PLB_RESEAU_REPRISE' },
  ),
  select(
    'PLB_RESERVE_EAU',
    "Réserve d'eau / surpresseur",
    [
      ['aucun', 'Aucun'],
      ['ok', 'Présent, bon état'],
      ['degrade', 'Présent, dégradé', 'orange'],
    ],
    { required: false, works: 'PLB_REDUCTEUR_PRESSION' },
  ),
  select(
    'PLB_ASSAINISSEMENT',
    'Mode d’assainissement',
    [
      ['egout', 'Tout-à-l’égout'],
      ['fosse', 'Fosse septique', 'orange'],
      ['puits_perdu', 'Puits perdu', 'red'],
      ['inconnu', 'Inconnu', 'orange'],
    ],
    { types: INDIVIDUAL, works: 'PLB_ASSAINISSEMENT' },
  ),
  check('PLB_COMPTEUR_INDIVIDUEL', "Compteur d'eau individuel", 'orange'),
];

// ---------------------------------------------------------------------------
// 6. Menuiseries & isolation
// ---------------------------------------------------------------------------
const MEN: ChecklistItem[] = [
  select('MEN_FENETRES_MATERIAU', 'Matériau des fenêtres', [
    ['aluminium', 'Aluminium'],
    ['pvc', 'PVC'],
    ['bois', 'Bois'],
    ['fer', 'Fer / acier', 'orange'],
  ]),
  select(
    'MEN_FENETRES_ETAT',
    'État des fenêtres',
    [
      ['bon', 'Bon'],
      ['jeu', 'Jeu / fermeture difficile', 'orange'],
      ['a_remplacer', 'À remplacer', 'red'],
    ],
    { room: true, works: 'MEN_FENETRE' },
  ),
  select('MEN_VITRAGE', 'Type de vitrage', [
    ['double', 'Double vitrage'],
    ['mixte', 'Mixte'],
    ['simple', 'Simple vitrage', 'orange'],
  ]),
  defect('MEN_ETANCHEITE_AIR', "Infiltrations d'air / joints de menuiserie dégradés", 'orange', {
    works: 'MEN_REGLAGE',
  }),
  select(
    'MEN_VOLETS',
    'Volets / occultations',
    [
      ['ok', 'Fonctionnels'],
      ['partiel', 'Partiellement fonctionnels', 'orange'],
      ['hs', 'Hors service', 'red'],
      ['absents', 'Absents', 'orange'],
    ],
    { works: 'MEN_VOLET' },
  ),
  select(
    'MEN_PORTE_ENTREE',
    "Porte d'entrée",
    [
      ['blindee', 'Blindée'],
      ['standard', 'Standard'],
      ['degradee', 'Dégradée', 'red'],
    ],
    { works: 'MEN_PORTE_BLINDEE' },
  ),
  select('MEN_PORTES_INTERIEURES', 'Portes intérieures', [
    ['bon', 'Bon'],
    ['usure', 'Usure', 'orange'],
  ]),
  defect('MEN_SERRURES', 'Serrures défectueuses', 'orange'),
  check('MEN_ALLEGES_SECURITE', 'Allèges et garde-corps de fenêtres sécurisés', 'red', {
    works: ['STR_GARDE_CORPS', 1500, 6000],
  }),
  select('MEN_GRILLES', 'Grilles de défense', [
    ['aucune', 'Aucune'],
    ['ouvrantes', 'Présentes, ouvrantes'],
    ['fixes', 'Fixes, sans ouverture de secours', 'orange'],
  ]),
  select('MEN_ISOLATION_THERMIQUE', 'Isolation thermique des parois', [
    ['isolee', 'Isolée'],
    ['partielle', 'Partielle'],
    ['non_isolee', 'Non isolée', 'orange'],
    ['inconnue', 'Non déterminable'],
  ]),
  defect('MEN_TOITURE_NON_ISOLEE', 'Toiture-terrasse non isolée au-dessus du logement', 'orange', {
    required: false,
    works: ['MEN_ISOLATION_TOITURE', 10000, 35000],
  }),
  select(
    'MEN_ISOLATION_PHONIQUE',
    'Isolation phonique perçue',
    [
      ['bonne', 'Bonne'],
      ['moyenne', 'Moyenne', 'orange'],
      ['mauvaise', 'Mauvaise', 'red'],
    ],
    { works: 'ENV_INSONORISATION' },
  ),
  select('MEN_EXPOSITION', 'Exposition principale', [
    ['nord', 'Nord'],
    ['sud', 'Sud'],
    ['est', 'Est'],
    ['ouest', 'Ouest'],
    ['traversant', 'Traversant'],
  ]),
  check('MEN_PROTECTIONS_SOLAIRES', 'Protections solaires sur façades exposées', 'orange', {
    works: 'MEN_PROTECTION_SOLAIRE',
  }),
];

// ---------------------------------------------------------------------------
// 7. Finitions & équipements
// ---------------------------------------------------------------------------
const FIN: ChecklistItem[] = [
  select(
    'FIN_SOLS',
    'État des sols',
    [
      ['bon', 'Bon'],
      ['usure', 'Usure', 'orange'],
      ['a_refaire', 'À refaire', 'red'],
    ],
    { room: true, works: ['FIN_SOLS', 3000, 12000] },
  ),
  select(
    'FIN_MURS',
    'État des murs',
    [
      ['bon', 'Bon'],
      ['a_repeindre', 'À repeindre', 'orange'],
      ['degrade', 'Dégradé (enduit à reprendre)', 'red'],
    ],
    { room: true, works: ['FIN_PEINTURE', 1500, 5000] },
  ),
  select(
    'FIN_PLAFONDS',
    'État des plafonds',
    [
      ['bon', 'Bon'],
      ['fissures', 'Fissures superficielles', 'orange'],
      ['degrade', 'Dégradé', 'red'],
    ],
    { room: true, works: ['FIN_PLAFOND', 1500, 6000] },
  ),
  defect('FIN_CARRELAGE_CREUX', 'Carrelage sonnant creux ou décollé', 'orange', {
    works: ['FIN_SOLS', 2000, 8000],
  }),
  defect('FIN_FAUX_PLAFOND', 'Faux-plafond fissuré ou affaissé', 'orange', {
    required: false,
    works: ['FIN_PLAFOND', 2000, 8000],
  }),
  select(
    'FIN_CUISINE',
    'État de la cuisine',
    [
      ['bon', 'Équipée, bon état'],
      ['usee', 'Équipée, usée', 'orange'],
      ['a_refaire', 'À refaire', 'red'],
      ['absente', 'Absente', 'red'],
    ],
    { photos: 1, works: 'FIN_CUISINE' },
  ),
  check('FIN_ELECTROMENAGER', 'Électroménager fonctionnel', 'orange', {
    required: false,
    works: 'FIN_ELECTROMENAGER',
  }),
  check('FIN_HOTTE', 'Hotte / extraction cuisine fonctionnelle', 'orange', {
    works: 'HUM_VENTILATION',
  }),
  select(
    'FIN_SALLE_EAU',
    "État des salles d'eau",
    [
      ['bon', 'Bon'],
      ['usee', 'Usée', 'orange'],
      ['a_refaire', 'À refaire', 'red'],
    ],
    { photos: 1, works: 'FIN_SALLE_EAU' },
  ),
  select(
    'FIN_CLIM_PRESENCE',
    'Climatisation',
    [
      ['aucune', 'Aucune', 'orange'],
      ['partielle', 'Partielle'],
      ['toutes_pieces', 'Toutes pièces'],
      ['centralisee', 'Centralisée'],
    ],
    { works: ['FIN_CLIMATISATION', 10000, 30000] },
  ),
  select(
    'FIN_CLIM_ETAT',
    'État de la climatisation',
    [
      ['bon', 'Bon'],
      ['entretien', 'Entretien nécessaire', 'orange'],
      ['hs', 'Hors service', 'red'],
    ],
    { required: false, works: 'FIN_CLIMATISATION' },
  ),
  select('FIN_CHAUFFAGE', 'Chauffage', [
    ['aucun', 'Aucun'],
    ['clim_reversible', 'Climatisation réversible'],
    ['radiateurs', 'Radiateurs électriques'],
    ['chaudiere', 'Chaudière'],
    ['cheminee', 'Cheminée / poêle'],
  ]),
  select(
    'FIN_ASCENSEUR',
    'Ascenseur',
    [
      ['non_necessaire', 'Non nécessaire (RDC / 1er)'],
      ['fonctionnel', 'Fonctionnel'],
      ['en_panne', 'En panne', 'red'],
      ['absent', 'Absent (étage ≥ 3)', 'orange'],
    ],
    { types: APPART },
  ),
  check('FIN_INTERPHONE', 'Interphone / visiophone fonctionnel', 'orange', { types: APPART }),
  defect(
    'FIN_GAZ_BOUTEILLE',
    'Bouteille de gaz en intérieur sans ventilation ou flexible périmé',
    'red',
    { works: 'FIN_GAZ' },
  ),
  check('FIN_DETECTEUR_FUMEE', 'Détecteur de fumée présent', 'orange', {
    works: 'FIN_SECURITE_INCENDIE',
  }),
  select(
    'FIN_PISCINE',
    'Piscine',
    [
      ['sans_objet', 'Sans objet'],
      ['bon', 'Bon état'],
      ['entretien', 'Entretien à prévoir', 'orange'],
      ['fuite', 'Fuite / équipement HS', 'red'],
    ],
    { types: INDIVIDUAL, photos: 1, works: 'FIN_PISCINE' },
  ),
  select(
    'FIN_JARDIN',
    'Jardin / espaces extérieurs',
    [
      ['sans_objet', 'Sans objet'],
      ['entretenu', 'Entretenu'],
      ['a_reprendre', 'À reprendre', 'orange'],
    ],
    { types: ['maison', 'villa'], works: 'FIN_JARDIN' },
  ),
  photo('FIN_PHOTOS_PIECES', 'Vue générale de la pièce', 2, { room: true }),
];

// ---------------------------------------------------------------------------
// 8. Environnement & habitabilité
// ---------------------------------------------------------------------------
const noise = (code: string, label: string, okMax: number, redAbove: number) =>
  measure(
    code,
    label,
    { unit: 'dB(A)', max_ok: okMax, input_min: 20, input_max: 130 },
    [gt(redAbove, 'red'), gt(okMax, 'orange')],
    {
      deferred: true,
      help: 'Sonomètre à 1 m de la fenêtre ouverte de la pièce principale, 1 minute, valeur LAeq.',
    },
  );

const ENV: ChecklistItem[] = [
  noise('ENV_BRUIT_MATIN', 'Niveau sonore matin (7h–10h)', 55, 70),
  noise('ENV_BRUIT_APRES_MIDI', 'Niveau sonore après-midi (13h–17h)', 55, 70),
  noise('ENV_BRUIT_SOIR', 'Niveau sonore soir (20h–23h)', 50, 65),
  defect('ENV_NUISANCE_CHANTIER', 'Chantier en cours à proximité', 'orange'),
  defect(
    'ENV_NUISANCE_MOSQUEE',
    'Mosquée à proximité immédiate (appel à la prière très audible)',
    'orange',
    {
      help: 'Information factuelle pour le client, sans jugement.',
    },
  ),
  defect('ENV_NUISANCE_CAFE', 'Café, restaurant ou bar bruyant à proximité', 'orange'),
  defect(
    'ENV_NUISANCE_ECOLE',
    'École à proximité immédiate (bruit aux heures de sortie)',
    'orange',
    { required: false },
  ),
  defect('ENV_NUISANCE_ROUTE', 'Axe routier très passant', 'orange'),
  defect('ENV_NUISANCE_ODEURS', 'Odeurs (décharge, égout, activité)', 'orange'),
  defect('ENV_ANTENNE_HT', 'Antenne relais ou ligne haute tension à proximité immédiate', 'orange'),
  defect('ENV_ZONE_INONDABLE', 'Indices de zone inondable (traces, témoignages)', 'red'),
  select('ENV_PARKING_TYPE', 'Stationnement', [
    ['garage_prive', 'Garage / box privé'],
    ['place_privee', 'Place privée extérieure'],
    ['residence', 'Parking de résidence sécurisé'],
    ['rue_facile', 'Rue, stationnement facile'],
    ['rue_difficile', 'Rue, stationnement difficile', 'orange'],
    ['aucun', 'Aucun stationnement possible', 'red'],
  ]),
  measure(
    'ENV_PARKING_DISTANCE',
    'Distance au stationnement le plus proche',
    { unit: 'm', max_ok: 200, input_min: 0, input_max: 5000 },
    [gt(500, 'red')],
  ),
  select('ENV_ACCES_VOITURE', 'Accès en voiture', [
    ['porte', "Jusqu'à la porte"],
    ['proche', 'À moins de 100 m'],
    ['pieton', 'Piéton uniquement (derb, médina)', 'orange'],
    ['difficile', 'Difficile (impasse, pente, ruelle étroite)', 'red'],
  ]),
  measure(
    'ENV_ACCES_NOTE',
    'Facilité d’accès et circulation aux heures de pointe (1 à 5)',
    { unit: '/5', min_ok: 3, input_min: 1, input_max: 5 },
    [lte(1, 'red'), lte(2, 'orange')],
  ),
  measure(
    'ENV_LUMINOSITE',
    'Luminosité naturelle (1 à 5)',
    { unit: '/5', min_ok: 3, input_min: 1, input_max: 5 },
    [lte(1, 'red'), lte(2, 'orange')],
    { room: true },
  ),
  select('ENV_VUE', 'Vue', [
    ['degagee', 'Dégagée'],
    ['partielle', 'Partiellement dégagée'],
    ['vis_a_vis', 'Vis-à-vis proche', 'orange'],
    ['mur', 'Mur / courette', 'orange'],
  ]),
  select('ENV_VOISINAGE', 'Voisinage', [
    ['calme', 'Calme'],
    ['anime', 'Animé'],
    ['degrade', 'Dégradé', 'orange'],
  ]),
  select('ENV_SECURITE', 'Sécurité perçue du quartier', [
    ['gardiennage', 'Résidence gardée'],
    ['normale', 'Normale'],
    ['sensible', 'Sensible', 'red'],
  ]),
  measure(
    'ENV_COMMERCES',
    'Commerces de proximité (minutes à pied)',
    { unit: 'min', max_ok: 10, input_min: 0, input_max: 120 },
    [gt(20, 'orange')],
  ),
  measure(
    'ENV_TRANSPORTS',
    'Transports en commun / taxis (minutes à pied)',
    { unit: 'min', max_ok: 10, input_min: 0, input_max: 120 },
    [gt(20, 'orange')],
  ),
  check('ENV_INTERNET', 'Fibre ou ADSL disponible', 'orange'),
  select('ENV_RESEAU_MOBILE', 'Réception réseau mobile 4G', [
    ['bonne', 'Bonne'],
    ['moyenne', 'Moyenne'],
    ['faible', 'Faible', 'orange'],
  ]),
  photo('ENV_PHOTOS_RUE', 'Photos de la rue et des abords', 2),
];

// ---------------------------------------------------------------------------
// 9. Potentiel locatif (purpose = location)
// ---------------------------------------------------------------------------
const LOC: ChecklistItem[] = [
  num('LOC_CHAMBRES', 'Nombre de chambres', { purposes: RENTAL }),
  num('LOC_SALLES_EAU', "Nombre de salles d'eau", { purposes: RENTAL }),
  num('LOC_COUCHAGES', 'Capacité de couchage actuelle', { purposes: RENTAL }),
  num('LOC_COUCHAGES_POTENTIEL', 'Capacité de couchage optimisée après aménagement', {
    purposes: LCD,
  }),
  select(
    'LOC_STANDING',
    'Standing du bien',
    [
      ['economique', 'Économique'],
      ['standard', 'Standard'],
      ['haut_de_gamme', 'Haut de gamme'],
      ['luxe', 'Luxe'],
    ],
    { purposes: RENTAL },
  ),
  select(
    'LOC_ESPACE_EXTERIEUR',
    'Espace extérieur privatif',
    [
      ['aucun', 'Aucun'],
      ['balcon', 'Balcon'],
      ['terrasse', 'Terrasse'],
      ['patio', 'Patio'],
      ['jardin', 'Jardin'],
    ],
    { purposes: RENTAL },
  ),
  select(
    'LOC_REGLEMENT_COPRO',
    'Location courte durée et règlement de copropriété',
    [
      ['autorise', 'Autorisée'],
      ['silencieux', 'Règlement muet / non consulté', 'orange'],
      ['interdit', 'Interdite', 'blocking'],
    ],
    { purposes: LCD, types: APPART },
  ),
  select(
    'LOC_CADRE_HEBERGEMENT',
    'Déclaration hébergement touristique (loi 80-14)',
    [
      ['faisable', 'Faisable'],
      ['a_verifier', 'À vérifier', 'orange'],
      ['impossible', 'Impossible en l’état', 'red'],
    ],
    { purposes: LCD },
  ),
  check(
    'LOC_ACCES_AUTONOME',
    'Arrivée autonome possible (boîte à clés, serrure connectée)',
    'orange',
    {
      purposes: LCD,
      works: 'LOC_SERRURE_CONNECTEE',
    },
  ),
  check('LOC_STOCKAGE_LINGE', 'Rangement pour linge et produits ménagers', 'orange', {
    purposes: LCD,
  }),
  select(
    'LOC_CONFIGURATION',
    'Configuration pour la location',
    [
      ['pret', 'Prêt à louer'],
      ['ameublement_leger', 'Ameublement léger à prévoir', 'orange'],
      ['ameublement_complet', 'Ameublement complet à prévoir', 'orange'],
      ['travaux_lourds', 'Travaux lourds avant location', 'red'],
    ],
    { purposes: RENTAL, works: 'LOC_AMEUBLEMENT_COMPLET' },
  ),
  select(
    'LOC_SMARTDECO',
    'Besoin SmartDeco',
    [
      ['aucun', 'Aucun'],
      ['home_staging', 'Home staging léger'],
      ['deco_complete', 'Décoration complète', 'orange'],
    ],
    { purposes: LCD, works: 'LOC_SMARTDECO' },
  ),
  measure(
    'LOC_NUITEE_ESTIMEE',
    'Prix de nuitée estimé',
    { unit: 'MAD', input_min: 0, input_max: 50000 },
    [],
    {
      purposes: LCD,
      required: false,
      help: 'Pré-rempli par le moteur Smart BNB, ajustable.',
    },
  ),
  measure(
    'LOC_OCCUPATION_ESTIMEE',
    "Taux d'occupation estimé",
    { unit: '%', input_min: 0, input_max: 100 },
    [],
    {
      purposes: LCD,
      required: false,
      help: 'Pré-rempli par le moteur Smart BNB, ajustable.',
    },
  ),
  measure(
    'LOC_LOYER_ESTIME',
    'Loyer mensuel estimé (longue durée)',
    { unit: 'MAD', input_min: 0, input_max: 200000 },
    [],
    {
      purposes: LLD,
      required: false,
    },
  ),
  text('LOC_ATOUTS', 'Atouts différenciants (vue, patio, piscine, rooftop…)', { purposes: RENTAL }),
  photo('LOC_PHOTOS_ANNONCE', 'Photos type annonce (lumière naturelle, cadrage large)', 6, {
    purposes: LCD,
  }),
];

// ---------------------------------------------------------------------------

const ALL_BLOCKS: Array<{
  code: BlockCode;
  label: string;
  items: ChecklistItem[];
  purposes?: Purpose[];
}> = [
  { code: 'ADM', label: 'Administratif', items: ADM },
  { code: 'STR', label: 'Structure', items: STR },
  { code: 'HUM', label: 'Humidité & étanchéité', items: HUM },
  { code: 'ELE', label: 'Électricité', items: ELE },
  { code: 'PLB', label: 'Plomberie', items: PLB },
  { code: 'MEN', label: 'Menuiseries & isolation', items: MEN },
  { code: 'FIN', label: 'Finitions & équipements', items: FIN },
  { code: 'ENV', label: 'Environnement & habitabilité', items: ENV },
  { code: 'LOC', label: 'Potentiel locatif', items: LOC, purposes: RENTAL },
];

export const TEMPLATE_V1: ChecklistTemplate = {
  key: 'thiqa-standard',
  version: 1,
  blocks: ALL_BLOCKS.map((b, i) => ({
    code: b.code,
    label_i18n: { fr: b.label },
    order: i + 1,
    applies_to: b.purposes ? { purposes: b.purposes } : {},
  })),
  items: ALL_BLOCKS.flatMap((b) => b.items),
};
