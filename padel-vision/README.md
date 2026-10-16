# PadelVision : les stats de ta partie, comme au laser game

Une borne au bord de chaque terrain de padel : un écran tactile et une caméra.
Avant la partie, les 4 joueurs saisissent leur prénom et se prennent en photo.
Pendant la partie, la caméra filme. À la fin, chacun scanne son QR code et
débloque son rapport pour **1 €** (ou un seul paie **4 €** pour les quatre) :

- points gagnés, coups joués, **coups gagnants** ;
- **fautes directes** (filet / dehors) et fautes provoquées ;
- **balles non rattrapées** dans sa zone ;
- **balles bien placées** (fond de court, grilles) ;
- volées, présence au filet, frappe la plus rapide (km/h), distance parcourue ;
- carte de ses positions sur le terrain et **axes d'amélioration** personnalisés.

Le club n'achète rien : le matériel est financé par l'exploitant, qui se
rémunère sur les analyses (partage de revenus possible avec le club).

---

## Démarrage rapide

```bash
cd padel-vision
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 1. Une partie simulée, analysée, avec les 4 rapports HTML
python -m padelvision demo --names "Alex,Bilal,Chloé,Dylan"

# 2. La borne complète, sans caméra (parties simulées, paiement factice)
python -m padelvision serve --demo
#    -> ouvrir http://localhost:8000 (écran de la borne)

# 3. Mesurer la précision du moteur
python -m padelvision evaluate

# Tests
pytest
```

Sur une vraie installation :

```bash
pip install -e ".[video,stripe]"
python -m padelvision calibrate --camera rtsp://camera-terrain-1/stream   # une fois, à l'installation
export PADEL_CAMERA=rtsp://camera-terrain-1/stream
export PADEL_PUBLIC_URL=https://terrain1.mondomaine.fr   # adresse ouverte par les QR codes
export STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…
python -m padelvision serve
```

Autres réglages (variables d'environnement) : `PADEL_COURT_ID`, `PADEL_CLUB_NAME`,
`PADEL_PRICE_CENTS` (100 par défaut), `PADEL_DATA_DIR`, `PADEL_CALIBRATION`,
`PADEL_RETENTION_DAYS` (30 par défaut).

---

## Comment ça marche

```
caméra ──► détection joueurs (YOLO) + balle ──► qui est qui (tenue + continuité)
                                   │
                                   ▼
             trajectoire 2D de la balle ──► cassures = événements
                                   │
                                   ▼
     lecture 3D de chaque cassure : rebond ? frappe (de qui) ? vitre ? filet ?
                                   │
                                   ▼
         règles du padel ──► coups, points, fautes ──► stats + rapport
```

**Le vrai problème technique** : avec une seule caméra, on ne voit pas la
profondeur. Une balle qui rebondit au sol et une balle frappée à 1 m de haut
peuvent tomber sur le même pixel. La solution retenue :

1. **Caméra sur le côté, au niveau du filet**, en hauteur (mât à ~8 m, 6 m du
   grillage, grand angle). La longueur du terrain est alors horizontale à
   l'image : les rebonds dessinent des « V » verticaux et les frappes des
   demi-tours horizontaux. Une caméra derrière le fond était le premier
   choix, mais l'essai a montré que la balle côté opposé n'y bouge que de 2 à
   7 pixels par image : inexploitable.
2. **Détection des cassures** : on compare la vitesse de la balle juste avant
   et juste après chaque image. Un saut brutal signale un événement.
3. **Hypothèses physiques** : à chaque cassure, la balle est sur le rayon
   caméra → pixel. On teste « au sol », « à la raquette de tel joueur »,
   « sur une vitre », « dans le filet ». Chaque hypothèse fixe le point 3D.
   La gravité et le freinage de l'air étant connus, on calcule la vitesse
   avant et après, et on garde l'hypothèse qui colle aux pixels **et** à la
   physique : un rebond ne peut pas accélérer la balle, une frappe la
   renvoie vers le filet, etc.
4. **Règles du jeu** : une équipe ne frappe jamais deux fois de suite (cela
   corrige les confusions vitre / frappe). Une balle qui touche la vitre en
   montant a forcément rebondi avant. La trajectoire de sortie d'une frappe
   prédit où elle retombe, même si le rebond n'est pas vu.
5. **Qui est qui** : pas de reconnaissance faciale. À 10-20 m, un visage fait
   quelques pixels, et c'est de la biométrie (voir RGPD). La photo de la borne
   donne une signature couleur de la tenue, combinée à la continuité des
   positions. Les côtés peuvent changer en cours de partie sans problème.

### Précision actuelle (parties simulées)

Le simulateur (`padelvision/simulate.py`) génère des parties physiquement
réalistes : gravité, frottement de l'air, rebonds, vitres, filet,
déplacements, bruit de détection et balles perdues. Il les « filme » avec la
caméra virtuelle. Résultat sur 4 parties de 30 points
(`python -m padelvision evaluate`) :

| | 30 images/s | 60 images/s |
|---|---|---|
| Points lus exactement (fin, gagnant, joueur décisif) | 80 % | 83 % |
| Frappes détectées | 89 % | 92 % |
| Frappe attribuée au bon joueur | 99 % | 100 % |
| Point de chute à moins de 50 cm | 90 % | 92 % |
| Écart sur les fautes directes (par joueur et par partie) | ±0,9 | ±0,7 |
| Écart sur les coups gagnants | ±1,1 | ±0,8 |

**À savoir** : sur de vraies vidéos, ce sera moins bon tant que la détection
de la balle n'est pas solide. C'est la priorité n°1 (voir feuille de route).
D'où la mention « statistiques estimées » sur le rapport. **Prendre une
caméra 60 images/s.**

---

## Matériel par terrain

Tout se trouve chez les fournisseurs chinois (Alibaba pour le volume,
AliExpress pour les prototypes). Mots-clés de recherche entre parenthèses.

| Élément | Choix conseillé | Prix indicatif |
|---|---|---|
| Caméra terrain | Caméra IP PoE 1080p **60 i/s**, grand angle ~100°, IP66 (« 1080P 60fps PoE wide angle IP camera starlight ») | 60-150 € |
| Calcul | NVIDIA Jetson Orin Nano 8 Go (analyse en direct), ou mini-PC + GPU | 250-350 € |
| Écran borne | Écran tactile 15,6" capacitif, extérieur/haute luminosité (« 15.6 inch capacitive touch monitor outdoor ») | 100-200 € |
| Webcam borne (photos joueurs) | Webcam USB 1080p | 15-30 € |
| Boîtier / pied | Borne kiosque métal IP54 ou caisson étanche | 100-250 € |
| Mât et fixations | Mât 6-8 m ou fixation sur la structure du club | 50-150 € |
| Réseau | Switch PoE ; routeur 4G si pas de wifi club | 30-80 € |
| **Total** | | **~600-1 200 €** |

Conseils d'achat : commander **un seul kit** pour valider avant le volume ;
exiger le marquage CE ; vérifier le flux RTSP et le 60 i/s réel (pas
seulement « 60 Hz ») ; prévoir l'alimentation électrique au bord du terrain
avec le club.

---

## Modèle économique

- Prix : 1 € par joueur et par partie, 4 € la partie complète.
- **Frais de paiement** : avec Stripe, ~0,25 € + 1,5 % par transaction en
  Europe, soit **plus d'un quart d'un paiement de 1 €**. Le bouton « je paie
  pour les 4 » est donc mis en avant. Étapes suivantes : porte-monnaie
  rechargeable (10 € = 10 analyses), ou option ajoutée directement à la
  réservation du terrain (partenariat Playtomic, logiciel du club).
- Ordre de grandeur : terrain à 1 000 €, 3 parties analysées par jour à
  4 €, environ 3,5 € nets par partie, soit ~10 € par jour : **amorti en 3 à 4
  mois**. À valider sur le terrain : le taux de conversion est l'inconnue n°1.
- Revenus additionnels : vidéo des meilleurs points (« highlights »), suivi
  de progression sur la saison, classement du club, offre pour les coachs.

---

## Vie privée et RGPD (à faire valider par un juriste)

- Filmer des joueurs = **données personnelles**. Il faut une information
  claire (panneau au terrain et écran de la borne), une base légale (ici le
  consentement, recueilli sur la borne), une durée de conservation limitée
  (30 jours par défaut, purge automatique), et un registre des traitements.
- **Pas de reconnaissance faciale** : identifier une personne par son visage
  relève des données **biométriques** (article 9 du RGPD), avec des
  contraintes bien plus lourdes et une CNIL très vigilante. Ici, la photo
  sert uniquement à afficher le joueur sur son rapport et à reconnaître sa
  tenue le temps de la partie.
- Une analyse d'impact (AIPD) est recommandée, car il s'agit d'une captation
  vidéo systématique.
- Mineurs : prévoir l'accord parental ou désactiver la borne pour les cours
  enfants.
- Convention écrite avec chaque club : emplacement, électricité, réseau,
  partage de revenus, affichage.

---

## Feuille de route

1. **Filmer 3 à 5 vraies parties** avec le kit et annoter les frappes et
   rebonds à la main. On mesure alors la précision réelle (même code
   d'évaluation que le simulateur).
2. **Détecteur de balle dédié** : YOLO entraîné sur des images de padel, ou
   TrackNetV3. Quelques milliers d'images annotées suffisent. C'est le gain
   de précision n°1.
3. **Analyse en direct sur le Jetson** pendant la partie, pour un rapport
   prêt une minute après la fin. En différé sur un mini-PC sans GPU, une
   heure de jeu prend plusieurs heures d'analyse.
4. **Posture des joueurs** (pose estimation) : détecter les frappes
   « invisibles » (balle renvoyée dans la même direction après une vitre) et
   reconnaître les coups (bandeja, víbora, smash, lob, chiquita).
5. Vidéo des meilleurs points, historique et progression par joueur
   (compte), classement du club.
6. Tableau de bord multi-terrains pour l'exploitant (revenus, pannes).

---

## Organisation du code

| Fichier | Rôle |
|---|---|
| `padelvision/court.py` | Calibration caméra (repères cliqués → matrice de projection), pixel ↔ terrain |
| `padelvision/trajectory.py` | Cassures de trajectoire 2D, rayons caméra, ajustement 3D ancré |
| `padelvision/events.py` | Hypothèses rebond / frappe / vitre / filet, choix physique |
| `padelvision/rally.py` | Règles du padel : coups, fautes, points, services, rebonds cachés |
| `padelvision/identity.py` | Qui est qui (signature couleur + continuité) |
| `padelvision/stats.py` | Statistiques par joueur, carte des positions |
| `padelvision/report.py` | Rapport HTML joueur (mobile) |
| `padelvision/detection.py` | Vidéo réelle : YOLO joueurs, détection et suivi de la balle |
| `padelvision/recorder.py` | Enregistrement caméra (USB ou RTSP) |
| `padelvision/server.py` | Borne : API, QR codes, paiement, rapports |
| `padelvision/payments.py` | Stripe Checkout ou paiement factice (démo) |
| `padelvision/store.py` | SQLite : parties, joueurs, paiements, purge RGPD |
| `padelvision/simulate.py` | Simulateur de parties avec vérité terrain |
| `padelvision/evaluate.py` | Mesure de précision |
| `kiosk/index.html` | Écran tactile de la borne |
