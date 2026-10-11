# VSL OEUF D'OR

Deux scénarios goScreen qui tournent les vidéos de présentation d'OEUF D'OR sur l'environnement de test
(https://oeufsdor.vercel.app et https://oeufsdor-pro.vercel.app), au format vertical 9:16 sur un Galaxy S25.

| Fichier | Film | Ce qui se passe hors caméra |
|---|---|---|
| `acheteur.scenario.json` | Recherche par zone, offre, 10 plateaux, numéro WhatsApp et code, commande, paiement FedaPay (bac à sable), code de remise, note, historique | Le producteur se connecte et valide la remise avec le code de l'acheteur (`{{order}}`, `{{pickup}}` retenus pendant la prise) |
| `producteur.scenario.json` | Connexion, accueil, premier produit, lot, retrait de casse, lots, commande payée, validation du code, note, retrait sur Mobile Money | Un acheteur commande et paie chez ce producteur, pour qu'une commande payée arrive |

## Lancer

1. Dans goScreen : barre de capture, **Scenario**, **Open file…**, choisir un des fichiers.
2. Remplir les valeurs demandées (numéros des comptes de test). Le producteur du film producteur doit être
   **sans produit** : « Ajouter mon premier produit » n'apparaît que dans ce cas.
3. **Record scenario**. La prise tourne en arrière-plan, puis le montage s'ouvre dans l'éditeur.

Les codes de connexion et de retrait sont lus dans les bandeaux de l'environnement de test, masqués avant
d'être affichés (`mask`), puis saisis à leur place (`{{code}}`).

## Attention : effets réels sur l'environnement de test

Chaque prise passe de vraies commandes : du stock réservé puis vendu, un paiement FedaPay en bac à sable, une
note (définitive), un retrait demandé par le producteur, à marquer versé ou à annuler dans l'admin. Les
limites d'achat (10 plateaux par jour par acheteur) et d'envoi des codes de connexion s'appliquent : prévoir
un acheteur de test frais par prise.

## `prototype/`

La première version, en scripts Playwright, avant que goScreen ait des scénarios : `lib.js` (capture CDP,
masques, cercles de toucher), un script par partie du parcours, `compose.js` (montage ffmpeg avec cadre et
légendes), `goscreen.js` (export en projet goScreen). Gardée comme référence ; les scénarios la remplacent.
Variables : `BUYER`, `PRODUCER_PHONE`, `PAY_PHONE`, `ORDER`, `CODE`.
