# GOSCREEN.md

Doc d'architecture vivante. A lire avant toute modification.

## Produit

Device Studio : n'importe quel device + n'importe quelle expérience web -> vidéo produit.
Le Device Engine est le coeur ; recording, caméra, timeline, export et cloud se construisent autour.

- Gestionnaire de paquets : **pnpm** uniquement (monorepo `pnpm-workspace.yaml`).
- Serveurs de dev : **Portly** (`portly status`), projet `goScreen`, serveurs `desktop` (:1430) et `web` (:3100).
- Base de données : `docker compose up -d` (Postgres 17 sur :5434).

## Arborescence

```
apps/
  desktop/            Tauri 2 + Vite + React 19 + TanStack Router/Query + shadcn
    src-tauri/        Rust : proxy de preview, capture FFmpeg (tout accès OS)
  web/                SaaS : TanStack Start + better-auth + TanStack Form + shadcn
packages/
  device-registry/    Définitions JSON validées par zod + Device Packs
  device-engine/      Fonctions pures : géométrie, orientation, safe area, layout, styles
  content-source/     Contrat DeviceContentSource : d'où viennent les pixels d'un frame (web, android…)
  android-source/     Modèle AndroidDevice, provider ADB (via transport injecté), gestes, choix de profil
  render-engine/      Éditeur, cœur pur : EditState, caméra/zoom, touch rings, timeline, composeFrame
  entitlements/       Plans -> droits. Seul endroit qui connaît les plans.
```

## Règles

- **Functional core, imperative shell** (repris de terax) : la logique vit dans des fonctions pures testées
  (`device-engine`, `proxy/rewrite.rs`, `recording/capture.rs`) ; commandes Tauri et composants React restent fins.
- Le Device Engine ne dépend ni de React ni du DOM, et ne connaît rien de l'éditeur vidéo.
- Aucun device codé en dur : tout passe par `createRegistry([...packs])`. Un pack ultérieur écrase un id existant.
- Jamais de `if (plan === "pro")` : utiliser `can*()` de `@goscreen/entitlements`.
- Le champ `plan` de l'utilisateur a `input: false` dans better-auth : le client ne peut jamais l'écrire.
- Mutations React Query : utiliser `isPending`, jamais de `useState` de chargement ; vérifier la forme des données dans `onSuccess`.
- Imports frontend en `@/...`. Composants `components/ui/` générés par shadcn : ne pas éditer à la main
  (exception : le registre génère parfois `from "cn"`, à remplacer par `@/lib/utils`).

## Stores (desktop)

Séparés comme demandé par le cahier des charges, jamais un store géant :

| Store | Fichier | Contenu |
|---|---|---|
| Project State | `modules/studio/store/project.ts` | URL, ratio, background, devices. Ce qui sera sauvé dans `project.json`. |
| Editor UI State | `modules/studio/store/editor.ts` | sélection, palette de commandes |
| Runtime State | `modules/interaction/runtime.ts` | location réelle de chaque page, nonce de reload |
| Recording State | `modules/recording/store.ts` | actif, startedAt, clockZero, journal d'interactions |
| Edit State | `modules/editor/store.ts` (`useEdit`) | zooms, trim, fond, touches, sons. Sauvé dans `<video>.edit.json`, undo/redo |
| Editor UI State | `modules/editor/store.ts` (`usePlayback`) | temps, lecture, panneau, qualité de preview, zoom sélectionné |
| Editor Session | `modules/editor/session.ts` | fichier ouvert, pointeurs, taille source, élément vidéo, `player` |

## Vues : Canvas et Scène

- **Canvas** (`modules/canvas/`) : espace infini pour comparer les devices côte à côte (modèle Instatic).
  La caméra `translate(pan) scale(zoom)` est écrite directement dans le DOM via `useCanvasView.subscribe`.
  Les frames, qui hébergent chacune une page vivante, ne se re-rendent jamais pendant un pan ou un zoom.
  Les maths sont pures (`math.ts`, testées). Les tailles qui doivent rester lisibles (étiquettes, poignées)
  sont divisées par `--canvas-zoom`.
- **Scène** (`modules/studio/components/Stage.tsx`) : la composition vidéo (ratio, fond, ombre, rotation).
  Record bascule toujours en Scène, car la zone capturée est le stage.
- `DeviceMockup` est le rendu commun aux deux vues. Changer de vue remonte les iframes.

## Synchro entre devices

- Chaque device a `synced`. Les devices synchronisés partagent l'URL du projet, la navigation et le scroll ;
  les autres gardent leur propre `url`.
- Seules les navigations causées par l'utilisateur sont propagées : clic sur un lien, ou changement de route SPA
  dans les 1,5 s qui suivent une saisie. Les redirections au chargement ne le sont pas, sinon deux devices
  redirigés différemment selon leur UA se rechargeraient en boucle.
- `useStableSource` évite de recharger le device qui a lui-même navigué quand l'URL partagée le rattrape.

## Rendu web dans le device : iframe + proxy local

Décision clé. Une WebView native ne peut ni pivoter, ni être mise en perspective, ni composée dans le DOM.
Une iframe peut, mais les sites publics la bloquent (`X-Frame-Options`). D'où :

1. `proxy_open(url, userAgent, touch)` suit les redirections, puis ouvre un listener `127.0.0.1:<port>` par
   couple (origine, UA). Un port par origine garde les URL root-relative valides et isole les origines entre elles.
2. Le proxy retire `X-Frame-Options`, CSP, COOP/COEP et HSTS, réécrit `Set-Cookie` (sans `Secure` ni `Domain`)
   et `Location` (une redirection cross-origin ouvre son propre listener).
3. Il injecte `/__goscreen/bridge.js` en tête du HTML. Le bridge :
   - surcharge `navigator.userAgent` et `maxTouchPoints` ;
   - poste au parent `pointer`, `down`, `up`, `scroll`, `navigate`, `location` (validés par zod côté app) ;
   - accepte `scrollTo`, `back` et `forward`.
4. Relais cross-origin (`proxy/relay.rs`) : le bridge envoie les `fetch`/XHR vers une autre origine à
   `/__goscreen/relay?u=…`, que le proxy rejoue avec la vraie origine du site (les API à liste blanche CORS
   répondent). Jamais de cookies relayés ; localhost, IP privées et noms résolus vers elles sont refusés
   (sauf si le site prévisualisé est lui-même local).
   Même règle pour la navigation : un site public (ouvert par l'utilisateur ou atteint par redirection) a des
   listeners `public_only` dont le client résout le DNS en écartant les adresses privées à la connexion ; une
   redirection vers localhost / une IP privée est refusée. Seul un site ouvert en local peut joindre le local.
5. L'iframe est sandboxée **sans** `allow-top-navigation` : une page prévisualisée ne peut pas naviguer la fenêtre du studio.

Limites connues : les cookies tiers en iframe (WebKit ITP) peuvent casser certains logins ; le HTML non UTF-8 est décodé en lossy.

## Recording

### Capture en calques (journal v3)

- La barre de capture (bouton Record) choisit la zone : **Device** (l'écran du device sélectionné, pleine
  résolution), **Canvas** (le viewport du canvas) ou **Scène** (le stage), plus une caméra et un micro.
  Stop reste dans la toolbar, hors de la zone capturée.
- Seul le **verre** de chaque device compte : `layerLog` note son rectangle dans la capture (toutes les 200 ms,
  à chaque changement). Pendant la prise, la Scène est aplatie (ni rotation ni tilt) et le canvas verrouillé,
  pour que chaque verre soit un rectangle droit et stable. Encoche et indicateur home ne sont pas gravés.
- L'éditeur recadre chaque verre et redessine le cadre du device depuis le registry (`editor/devices.ts`) :
  modèle, couleur, cadre, taille, rotation et position changent après coup. Les touches sont stockées en
  coordonnées du verre (`u`, `v`) et suivent le calque.
- Caméra et micro : un second FFmpeg (`recording/companion.rs`) écrit `<stem>.camera.mp4` et `<stem>.mic.m4a`.
  `media.offsetMs` aligne leur départ sur la première frame de l'écran. Un échec caméra/micro n'empêche
  jamais l'enregistrement de l'écran (avertissement). Webcam en overlay (coin 3x3, taille, forme, miroir) ou
  en split screen ; le micro est mixé à l'export.
- Bulle webcam live (`recording/LiveCamera.tsx`) au-dessus du Canvas et de la Scène : `getUserMedia` retrouve la
  caméra FFmpeg par son nom. Glisser = aimantation sur la grille 3x3 (`nearestCorner`), clic droit = taille, forme,
  miroir. Sa mise en page part dans le journal (`camera`) et devient l'overlay initial de l'éditeur. Pendant la
  prise, elle se masque si elle chevauche un verre (elle serait sinon gravée dans le calque).
- Démarrage : FFmpeg ne crée la sortie qu'à la première frame. Sans fichier après 6 s, c'est la permission
  « Enregistrement de l'écran » qui manque : erreur explicite qui nomme l'app responsable (premier `.app`
  parmi les ancêtres du process, `recording/permissions.rs`) avec un bouton vers le bon panneau des Réglages.
  En dev, c'est **Portly.app**. Arrêt : `q`, puis SIGINT, puis kill. Les PID sont notés dans le cache : un FFmpeg orphelin
  (crash, rebuild) est tué au lancement suivant.

### Pause

- Pause / Reprendre (toolbar, ⇧⌘P) ne coupe jamais la capture : les intervalles en pause (secondes depuis la
  frame 0) partent dans le journal (`pauses`). À la première ouverture, `clipsWithout` (pur, testé) découpe la
  piste principale autour d'eux ; caméra, micro, touches et zooms suivent (temps source). Un bord de clip tiré
  récupère un passage coupé. Aucun redémarrage SCK/FFmpeg, donc aucune désynchro.

### Devices séparément

- Option « Separately » de la barre de capture (Canvas/Scène, 2 devices ou plus). Sur le canvas, les devices
  sont d'abord serrés pour remplir la vue (plus de pixels par device), puis la vue est restaurée.
- À l'arrêt, `splitParts` (pur, testé) dérive une partie par verre : rectangle (union de ses positions) et
  journal où ce verre remplit tout le cadre, touches en `u, v`. `recording_split` (Rust, `recording/split.rs`)
  recadre avec FFmpeg (x264 CRF 16) en `<stem>-devN-<modèle>.mp4` et écrit son journal, `media` (caméra, micro)
  recopié. Chaque partie s'ouvre seule dans l'éditeur : cadre, touches et zooms fonctionnent.

### Site tour

- « Site tour » (barre de capture) enregistre un site entier en une prise. Rust (`modules/site/`) trouve les
  pages : `sitemap.xml`, sinon les liens internes de l'accueil et des pages liées (même origine, sans assets).
- `tour/runTour.ts` : bascule de vue et chargement de la 1re page **avant** de lancer la caméra, puis pour
  chaque page : ouverture sur tous les devices web synchronisés (attente des `location` de type `load`),
  pause, scroll doux de haut en bas (`scrollTo` via le bridge), pause. Stop dans la toolbar arrête le tour.
  Timings purs et testés dans `tour/plan.ts`.

### Capture native

Les iframes cross-origin ne se dessinent pas dans un `<canvas>`, donc la capture est native :

- **macOS 15+** : ScreenCaptureKit (`recording/sck.rs`) enregistre **la fenêtre goScreen seule** (filtre fenêtre +
  `sourceRect`, encodage H.264 système via `SCRecordingOutput`). Une autre fenêtre, une notification ou un menu
  par-dessus n'apparaît jamais dans la vidéo, et la fenêtre peut être sur n'importe quel écran. Les captures
  d'écran passent par `SCScreenshotManager`. Le pont Swift de la crate exige le rpath `/usr/lib/swift` (`build.rs`).
- **Ailleurs (repli)** : `recording_start(region)` convertit le rectangle (CSS px) en pixels physiques écran et lance
  FFmpeg via un `ScreenCaptureProvider` (avfoundation + crop sur macOS < 15, gdigrab sur Windows, x11grab sur Linux).
- La zone suit la vue à l'écran : Canvas et Scène enregistrent la vue courante (jamais de bascule) ; seul le mode
  Device est mémorisé. Une prise Device cadre d'abord le device dans le canvas (plus de pixels), puis restaure la vue.
Le curseur n'est **pas** gravé dans la vidéo. Les interactions sont écrites à côté du MP4 (`*.interactions.json`)
pour garder touch, zoom et curseur éditables après la capture.

- Sortie : `~/Movies/goScreen/` (vidéos), `~/Pictures/goScreen/` (captures).
- macOS : l'app (ou Portly en dev) doit avoir la permission « Enregistrement de l'écran ». Le repli FFmpeg
  exige en plus que la fenêtre soit sur l'écran principal.
- FFmpeg est cherché dans le PATH puis dans `/opt/homebrew/bin` et `/usr/local/bin` (une app GUI macOS a un PATH minimal).

## Sources de contenu

Un frame affiche une source (`ProjectDevice.source`) : `{ kind: "web" }` (iframe + proxy) ou
`{ kind: "android", serial }`. Le Device Registry décrit l'apparence (`pixel-10-pro`), la source décrit
l'instance réelle (`emulator-5554`) : on peut changer de profil sans changer d'app. Le Device Engine
n'en sait rien.

## Android (ADB)

- Tout process ADB tourne en Rust (`src-tauri/src/modules/android/`), jamais dans le thread UI.
  `adb` est cherché : réglage utilisateur, `ANDROID_HOME`/`ANDROID_SDK_ROOT`, PATH, SDK par défaut, Homebrew.
- Sécurité : serials validés (`[A-Za-z0-9._:-]`), argv uniquement (jamais de shell hôte), input typé
  (`tap`/`swipe`/`key` en entiers bornés, touches en liste fermée).
- Écran live : `adb exec-out screenrecord --output-format=h264` -> FFmpeg -> MJPEG sur `127.0.0.1`, affiché
  par un `<img>` dans le DeviceMockup. Chaque connexion HTTP possède son pipeline : fermer l'image tue adb
  et ffmpeg. screenrecord est relancé à sa limite de durée ; 3 morts rapides = appareil perdu.
- Le frame prend le ratio réel (`viewportFor`) et suit la rotation de l'émulateur (`useAndroidSync`, poll 3 s).
  Rien ne se connecte ni n'enregistre sans clic explicite.
- Les erreurs Rust sont `{ code, detail }` ; `describeAndroidError` les traduit en phrases actionnables.
- Limite : un swipe est rejoué au relâchement (pas de drag en direct) ; pas encore d'audio Android.

## Éditeur post-recording (`/editor?video=…`)

- Le journal v2 (`*.interactions.json`) stocke des pointeurs en secondes depuis la frame 0
  (`clockZero` = appel + `spawnOffsetMs` renvoyé par Rust) et en coordonnées normalisées du stage.
  La projection écran -> stage passe par 4 marqueurs de coins (`stagePoint.ts`) et une homographie :
  exacte même en perspective. Les fichiers v1 s'ouvrent sans touches.
- Non destructif : le MP4 n'est jamais modifié ; les effets vivent dans `*.edit.json` (autosave, parse
  champ par champ avec repli).
- Un seul rendu : `composeFrame` (pur) + `drawFrame` (Canvas2D) servent la preview et l'export.
  La vidéo est servie par un serveur média local (Range + CORS) pour que le canvas ne soit pas « tainted ».
- Serveurs locaux de l'app (média, flux Android) : URL à jeton aléatoire 128 bits, CORS limité à l'origine
  du studio, toute autre `Origin` refusée (`local_http.rs`). Les sites prévisualisés vivent aussi sur 127.0.0.1.
- Export : seek frame par frame -> JPEG (q 0,98) -> `export_frame` (corps IPC brut) -> FFmpeg (x264 slow, CRF 15,
  conversion explicite en BT.709) ; second passage pour
  mixer les sons de tap synthétisés. Sortie `~/Movies/goScreen/<nom>-export-<stamp>.mp4`.
- `buildAutoZooms` (render-engine) propose des zooms à la première ouverture ; tout reste éditable.

### Montage (EditState v2)

- **Piste principale** = séquence de clips joués bout à bout (`sequence.ts`, pur et testé) : clips d'enregistrement
  (`in`/`out` en temps source, `speed`, `muted`, `cameraHidden`) et slides plein cadre. Split, trim, réordonnancement
  et suppression sont en *ripple*. Le temps de la timeline (`usePlayback.time`) est le temps de séquence ;
  zooms, touches, caméra et micro restent en **temps source** et suivent les clips (`sourceTimeAt`, `timelineTimesOf`).
- **Overlays** (texte, image, vidéo, forme) et **audio** (musique) : libres en temps timeline, sur des lanes.
  Animations d'entrée/sortie pures (`motion.ts`), dessinées par `drawOverlays.ts` en preview comme à l'export.
- Les médias ajoutés sont copiés dans `<stem>.assets/` (`asset_import`) et servis par le serveur média.
- L'export mixe la bande-son par morceaux (`audioPieces` -> `export_finish`) : micro découpé par clip, musiques, sons de tap.
- UI : `Timeline.tsx` (pistes), `TimelineToolbar.tsx` (ajout de contenu, split, zoom de timeline),
  `TimelineMenus.tsx` (clic droit), `SelectionPanels.tsx` (propriétés de l'élément sélectionné), `actions.ts`.

## Vérifications

- Frontend : `pnpm -r check-types`, `pnpm -r test`, `pnpm lint`
- Rust : `cd apps/desktop/src-tauri && cargo test` (via `portly temp`)
- Web : `pnpm --filter @goscreen/web auth:migrate` après un changement de schéma better-auth

## Plan : vidéos produit automatiques, pilotées par la campagne

But : une URL + le brief d'une campagne client -> 8 montages prêts, dans le style des démos SaaS en motion design.
Rien n'est écrit pour un site en particulier : tout dérive de **trois entrées** :

1. le **site** (marque, pages, sections, repères), lu automatiquement ;
2. la **campagne** (objectif, cible, ton, offre, CTA, canaux), saisie ou complétée par le client ;
3. le **catalogue de recettes** (structures de montage génériques), qui ne connaît ni l'un ni l'autre.

Une seule capture ; chaque proposition est un `EditState` généré, donc une preview live (`composeFrame`) et un
montage éditable, jamais 8 exports.

### Site de référence (fixture, pas cible)
https://oeufsdor.vercel.app/ sert de **cas de test**, jamais de cas particulier dans le code. Il exerce
(relevé le 2026-10-09) : meta/og riches, `lang="fr"`, un `h1` + 6 `h2` de section ; couleurs en chaîne de
variables (`--primary: var(--yolk)`) et `theme-color` qui n'est que le fond (la marque est dans le favicon SVG) ;
2 polices (titres / texte) ; `sitemap.xml` de 8 pages. Ajouter au moins un second site au profil opposé
(SaaS anglophone, sombre, sans sitemap) pour vérifier que rien ne dépend du premier.

### Références vidéo (style à atteindre)
- Playlist « What a Story » (100 vidéos, relevée le 2026-10-09) :
  https://www.youtube.com/playlist?list=PLvr0s6WLGo2bCGXjB5ecHQ-JLPgmxMULe ; plus `wwIt5ZvROrs` (démo fintech) et
  `SgmuplXU2iY` (pub de lancement LangEase). Ce sont des **références de style et de structure**, pas des gabarits à copier.
- Genres observés -> recettes : *Explainer* (60-120 s), *Product launch* (45-70 s), *Teaser* (15-30 s),
  *Product demo / walkthrough* (UI animée), *Video ad* (15-30 s), *Onboarding / tutorial*, *Booth video* (boucle
  muette pour salon), *Integration* (« X x Y »), *Use case par secteur*. Le guide « 7 video types » de l'agence
  (`XP6dqsEQyJE`) ajoute *Testimonial / case study*, *Review / comparison* et *Corporate*.
- Structure dominante d'un explainer : accroche / problème -> apparition du produit (logo) -> 3 fonctionnalités en
  UI animée (zoom sur un composant, carte flottante, curseur) -> bénéfice chiffré ou preuve -> CTA + URL ; voix off
  sur toute la durée, musique rythmée, transitions sur les temps forts.
- Atteignable nativement : UI animée à partir de la vraie capture, texte animé, cartes flottantes, caméra 3D,
  transitions, voix off (enregistrée, plus tard synthétisée), musique. **Hors périmètre** : personnages 2D,
  illustrations isométriques sur mesure, prises de vue réelles. Une recette ne promet jamais ces visuels.

### Modèle `Campaign` (package `@goscreen/campaign`, pur, zod)
- `{ objective, audience, tone, offer, cta: { label, url }, channels, language, durationHint, focus, brand }`
  - `objective` : `launch | acquisition | promo | feature | recruit-supply | awareness` ;
  - `channels` -> formats déduits (`instagram-reel`/`tiktok` = 9:16, `linkedin` = 1:1 ou 16:9, `youtube` = 16:9…) ;
  - `focus` : pages ou sections à mettre en avant (sinon choisies par score) ;
  - `brand` : surcharges de la marque extraite (couleur, logo, police) ;
  - `tone` règle rythme, transitions, animations de texte et tempo de musique.
- `defaultCampaign(brand, sections)` propose un brief rempli depuis le site ; le client corrige.
- Sauvé avec le projet (`<stem>.campaign.json`), parse champ par champ avec repli.

### Tranche A : lecture du site (Rust, pur + testé)
- `modules/site/brand.rs` : `site_brand(url)` -> `{ name, tagline, description, lang, colors: { background,
  primary, accent, ink }, fonts: { heading, body }, logo }`. Sources par priorité : variables CSS courantes
  (`--primary`, `--brand`, `--accent`, `--background`, `--foreground`, résolution des `var()`), couleur dominante
  du logo / favicon SVG, `theme-color` ; meta/og, `h1`. Même garde réseau que le proxy (`public_only`).
- `site_sections(url)` : sections par page avec un **rôle** déduit génériquement (structure + mots-clés multilingues) :
  `hero | features | pricing | stats | how-it-works | testimonials | listing | faq | cta | other`.
- Fixtures de chaque site de référence dans `tests/`.

### Tranche B : chapitres et repères dans la prise (journal v4, rétrocompatible)
- `runTour` écrit `chapters: [{ url, title, start, end }]` : une page = un chapitre.
- Le bridge répond à `marks` : rectangles (en `u, v` du verre) des titres, CTA, cartes et chiffres visibles,
  avec leur rôle, notés à chaque pause -> `marks: [{ t, role, text, u, v, w, h }]`.
- Le tour peut suivre `campaign.focus` (pages à parcourir, ordre) plutôt que tout le sitemap.
- Un journal v3 s'ouvre sans chapitres ni repères.

### Tranche C : recettes (render-engine, pur + testé)
- Une recette = `{ id, label, objectives, formats, needs: Role[], build(ctx) -> EditState }`, où
  `ctx = { recording, brand, sections, campaign, format }`. Aucune ne cite un site.
- `buildProposals(ctx) -> Proposal[8]` : **score** chaque couple (recette, format) selon l'objectif, les canaux et
  les rôles disponibles (pas de « Prix + CTA » sans section `pricing`), puis garde les 8 meilleurs, variés.
- Textes : accroche, bénéfices et CTA viennent de la campagne, sinon des sections ; langue = `campaign.language`.
  Point d'extension `CopyProvider` (gabarits locaux par défaut, rédaction IA plus tard via le web).
- Zooms sur les **repères** du rôle visé (remplace `buildAutoZooms` dans ces montages).
- Catalogue aligné sur les genres de référence. MVP : **Product launch**, **Product demo / walkthrough**,
  **Video ad verticale**. Puis : **Explainer** (problème -> solution, voix off), **Teaser** rythmé, **Integration**,
  **Booth video** (boucle muette), **Use case** (une section `listing` / `stats` mise en scène), Prix + CTA.
  Chaque recette suit la structure de son genre ; la campagne choisit lequel et règle durée, ton et textes.

### Tranche D : bouton « Propositions » (desktop)
- URL -> lecture du site -> formulaire de brief prérempli (objectif, cible, offre, CTA, canaux) -> tour
  automatique (devices selon les formats) -> galerie des 8 previews live, avec la raison du choix ->
  « Ouvrir dans l'éditeur » écrit `<stem>.edit.json`. Changer le brief régénère sans refaire la capture.

### Tranche E : finition motion design
- Caméra 3D animée, cartes flottantes (un repère détaché du verre), typographie lettre à lettre / masque,
  synchro sur le tempo, curseur synthétique.

### Critères de test (sur chaque site de référence)
1. `site_brand` et `site_sections` trouvent nom, accroche, couleur de marque, polices et rôles des sections.
2. Deux briefs différents sur le même site (ex. `acquisition` + Instagram vs `launch` + YouTube) donnent des
   propositions différentes en format, ordre, textes et sections mises en avant.
3. Les recettes sans les rôles nécessaires ne sont pas proposées.
4. Les propositions s'exportent sans retouche et restent entièrement éditables.
5. `grep -ri oeufsdor packages apps` ne trouve que des fixtures de test.
6. Revue côte à côte avec 3 vidéos de la playlist du même genre : même structure de scènes, même rythme de
   coupe (± 20 %), textes lisibles, CTA final présent.

## Prochaines tranches verticales

0. Vidéos produit automatiques pilotées par la campagne : tranches A à E ci-dessus (oeufsdor = fixture de référence).
1. Éditeur : curseur pour les sources web, motion blur, transitions entre clips, crop ; export plus rapide.
2. Android : drag en direct, audio (`AndroidAudioProvider`), « Synchronize Interactions » multi-device.
3. `project.json` versionné, avec migrations.
4. Connexion desktop -> web (jeton dans le keychain, entitlements vérifiés côté serveur).
5. Fichier HTML local, browser chrome (Safari / Chrome Android), status bar custom.
