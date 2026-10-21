# GOSCREEN.md

Doc d'architecture vivante. A lire avant toute modification.

## Produit

Device Studio : n'importe quel device + n'importe quelle expérience web -> vidéo produit.
Le Device Engine est le coeur ; recording, caméra, timeline, export et cloud se construisent autour.

- Gestionnaire de paquets : **pnpm** uniquement (monorepo `pnpm-workspace.yaml`).
- Serveurs de dev : **Portly** (`portly status`), projet `goScreen`, serveur `desktop` (:1430).
- Licence MIT, projet open source : rien ne dépend d'un compte ni d'un serveur.
- Release : un tag `v*` lance `.github/workflows/release.yml` (macOS arm64/x64, Windows, Linux) et crée une release brouillon.

## Arborescence

```
apps/
  desktop/            Tauri 2 + Vite + React 19 + TanStack Router/Query + shadcn
    src-tauri/        Rust : proxy de preview, capture FFmpeg (tout accès OS)
packages/
  device-registry/    Définitions JSON validées par zod + Device Packs
  device-engine/      Fonctions pures : géométrie, orientation, safe area, layout, styles
  content-source/     Contrat DeviceContentSource : d'où viennent les pixels d'un frame (web, android…)
  android-source/     Modèle AndroidDevice, provider ADB (via transport injecté), gestes, choix de profil
  blocks/             Blocs de motion design (HTML/CSS animé, sans script), réglages décrits pour l'UI et l'IA
  render-engine/      Éditeur, cœur pur : EditState, caméra/zoom, touch rings, timeline, composeFrame,
                      animation par le temps (interpolate, spring)
  scenario/           Scénarios (zod, pur) : format, valeurs {{…}}, montage tiré d'une prise
  scenario-runner/    Node + Playwright : joue un scénario, écrit le MP4 et son journal
  campaign/           Brief de campagne (zod), catalogue de recettes, choix des 8 propositions (pur)
  motion/             Spec de motion design (zod, pur) : mesures d'une vidéo de référence, spec dérivée,
                      rendu HTML, comparaison, relecture par une IA, exemples d'apprentissage du modèle local
  inspiration/        Bibliothèque de prompts partagés (pur, zod) : direction créative lue dans chaque prompt,
                      recherche, réglages de film, brief pour l'IA
```

## Règles

- **Functional core, imperative shell** (repris de terax) : la logique vit dans des fonctions pures testées
  (`device-engine`, `proxy/rewrite.rs`, `recording/capture.rs`) ; commandes Tauri et composants React restent fins.
- Le Device Engine ne dépend ni de React ni du DOM, et ne connaît rien de l'éditeur vidéo.
- Aucun device codé en dur : tout passe par `createRegistry([...packs])`. Un pack ultérieur écrase un id existant.
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

### Scénarios (prises scriptées, Playwright)

Un **scénario** (`*.scenario.json`, `@goscreen/scenario`, pur et testé) décrit un parcours sur un vrai site :
`goto`, `tap` (`repeat`), `type` (avec ou sans cible, `clear`), `press`, `check`, `scroll` (`by` ou `to`),
`wait`, `waitFor`, `waitUrl`, `session` (un autre compte, ses propres cookies), `remember` (garde une valeur
tirée d'un texte ou de l'URL), et `scene` / `cut`. Une **cible** se trouve par `css`, `text`, `role` (+ `name`),
`label`, `placeholder` ou `testId`, affinée par `hasText`, `nth` (-1 = dernier) et `frame` (CSS d'une iframe :
fenêtres de paiement). Les valeurs `{{nom}}` (`vars`) sont demandées avant la prise ; `{{code}}` est le dernier
code lu dans un bloc masqué, et les noms `remember` se remplissent pendant la prise.

- **Aucune capture d'écran** : `packages/scenario-runner/run.mjs` (Node, `playwright-core`) pilote un Chromium
  sans fenêtre (Chrome installé, sinon le Chromium de Playwright) émulé comme le device du registry (viewport,
  densité, UA, tactile). Les images viennent du screencast CDP ; un compteur à 30 i/s répète la dernière image
  quand l'écran ne bouge pas, donc la vidéo garde le temps réel et chaque scène dure ce qu'elle a duré.
- **Masques** (`mask`, expressions régulières) : un script injecté avant ceux de la page cache chaque bloc
  correspondant avant qu'il soit dessiné (bandeaux de test, codes) ; ses chiffres deviennent `{{code}}`.
- La prise est un journal v3 en mode `device` : un calque plein verre, les touches en `u, v`, et une
  **scène = un chapitre avec sa légende** (`chapters[].caption`). Un `cut` laisse un trou (connexion, chargement).
- **Montage dérivé de la prise** (`buildScenarioEdit`, pur) : carton d'ouverture, un clip et une légende par
  scène, zooms sur les rafales de touches (dans leur scène), touches dessinées par l'éditeur, cadre du device,
  carton de fin. Les réglages sont les « props » du film (`film` : format, couleurs, police, place des légendes,
  zoom, cartons). Tout reste éditable dans l'éditeur ; l'espace insécable français est posé si `locale` est `fr`.
- Desktop : bouton **Scenario** de la barre de capture (`modules/scenario/`), éditeur JSON avec validation
  située (`steps.3.target: …`), liste des étapes, champs des valeurs (les valeurs `secret` ne sont jamais
  gardées), progression et Stop dans la toolbar. À la fin, `<stem>.edit.json` est écrit et l'éditeur s'ouvre.
- Rust (`modules/scenario/`) : `scenario_run` trouve Node (PATH, asdf, nvm, fnm, volta, Homebrew ;
  `GOSCREEN_NODE`), le runner (`GOSCREEN_SCENARIO_RUNNER`, sinon celui du dépôt) et FFmpeg, écrit le job dans un
  fichier temporaire supprimé à la fin (il contient les valeurs saisies), relaie les lignes JSON du runner en
  événements `scenario-progress`. Un échec rend l'étape, le message et une capture `<stem>.failed.png`.
  `scenario_cancel` arrête le runner (SIGTERM), qui supprime la vidéo partielle.
- Limite : le runner a besoin de Node et de ses dépendances (`pnpm install`) ; il n'est pas encore embarqué
  dans l'app packagée.
- Exemples : `EXAMPLE_SCENARIO` (TodoMVC public, « Insert example ») et `examples/oeufdor-vsl/` (parcours
  acheteur et producteur complets, plus le prototype en scripts Playwright qui a précédé le format).

### Projets, flows de VSL et tâches de fond

- **Accueil = projets** (`/`, `modules/projects/`) : un dossier par projet dans `<Vidéos>/goScreen/Projects/<id>/`
  (`project.json` garde le nom ; l'id, tiré du nom à la création, ne change jamais, donc renommer ne déplace
  rien). Un projet contient ses VSL (`vsls/<id>.flow.json`) et les prises tournées depuis eux. Créer, renommer,
  dupliquer (les VSL, pas les vidéos), supprimer : bouton « … » ou clic droit. **Supprimer envoie à la corbeille
  du système** (crate `trash`), jamais une suppression définitive. Rust (`modules/projects/`) : le studio n'envoie
  que des ids (`[a-z0-9-]`, vérifiés), jamais de chemin. Le studio libre reste sur `/studio`.
- **Flow d'un VSL** (`/flow?project&vsl`, `modules/flow/`, React Flow `@xyflow/react`, MIT) : un nœud **Départ**
  (site, appareil, langue, film, valeurs, masques) puis des nœuds **Scène** (filmée, avec sa légende), **Hors
  caméra** (jouée, coupée du montage) et **Session** (un autre compte). Chaque chemin du Départ à une feuille est
  un **parcours** ; une branche est une variante. Modèle pur et testé dans `@goscreen/scenario` (`flow.ts`) :
  `flowPaths`, `pathTo`, `compileFlow` (parcours -> scénario, avec l'origine de chaque étape), `flowIssues`,
  `flowFromScenario` (import, déjà rangé), `layoutFlow` (« Tidy up » : une colonne par profondeur, branches
  empilées, et un parcours long revient à la ligne toutes les 6 colonnes, comme un texte ; `LAYOUT`, nœuds de
  224 px espacés de 48 ; le lien qui revient à la ligne est tracé en angles droits). Tourner plusieurs parcours les joue bout à bout dans
  une seule prise : chaque parcours après le premier repart du Départ dans des sessions neuves (`pathN`), pour
  ne jamais partager un panier ou une connexion. Sauvegarde automatique (600 ms).
- **Enregistrer sur le site** (« Record actions on the site », bouton du nœud ou clic droit ;
  `LiveRecorder.tsx`, `scenario-runner/live.mjs`) : le runner rejoue le parcours jusqu'à ce nœud (ses étapes
  comprises), puis diffuse la page (screencast ~8 i/s, événements `scenario-live`) et reçoit les commandes du
  studio sur son entrée standard (`scenario_live_send`). Un clic est joué sur le site et revient en étape ; la
  cible est trouvée par le runner (`describeAt` dans la page, puis `chooseTarget` garde la première façon de
  nommer l'élément qui le trouve dans Playwright : test id, rôle + nom, label, placeholder, texte, id stable,
  chemin CSS ; `nth` si plusieurs éléments portent le même nom ; iframes comprises, `frame`). Survol = cadre et
  nom de la cible ; « Pick only » choisit sans cliquer (attendre, défiler jusqu'à, retenir le texte, cocher) ;
  saisie de texte ou de `{{valeurs}}` (la valeur est tapée, l'étape garde `{{nom}}`), code reçu, Entrée, molette
  = une étape de défilement par geste. Canal séparé des tâches de fond (un `Slot` Rust chacun). Testé de bout en
  bout (`live.test.mjs`, page locale).
- **Simuler** joue un parcours sans filmer (`dry` : ni screencast ni FFmpeg) et colore les nœuds : vert = passé,
  orange = en cours, rouge = l'étape a échoué ici (`origins` relie chaque étape à son nœud).
- **Tâches de fond** (`modules/tasks/`) : simulations et tournages passent par une file (le runner joue un
  scénario à la fois) ; le studio reste libre. Panneau sur tous les écrans : progression, miniature en direct
  (le runner envoie une capture toutes les 1,5 s, `preview`), une vignette par scène terminée, erreur avec
  l'étape fautive et sa capture, ouverture du résultat. Les tâches finies restent listées (sans images) entre
  deux sessions.
- Menus contextuels : flow (nœud : ajouter la suite, simuler jusqu'ici, tourner les parcours qui passent ici,
  transformer, dupliquer, délier, supprimer ; fond : ajouter un nœud ici, ranger, tout simuler, tourner ; lien :
  supprimer), étapes d'un nœud, projets, VSL, vidéos, tâches ; éditeur : « Zoom here » sur l'aperçu,
  « Caption every scene » ; piste **Video** (ex-« V1 », la piste principale : clips et cartons) : carton, légendes
  des scènes, zoom sur chaque clic, retirer les zooms ; studio : « Start a scenario on this page ».

### Animation façon After Effects

- **Images clés par propriété** (`render-engine/animation.ts`, pur et testé) sur tout calque : `x`, `y` (centre,
  fractions), `scale`, `rotation` (degrés), `opacity`, `blur` (fraction du petit côté). Une clé `{ t, value, ease }`
  (t en secondes depuis le début du calque) porte la courbe vers la suivante : `linear`, `hold`, `in`, `out`,
  `in-out`, `back`, `elastic`, `spring` ou `{ bezier: [x1, y1, x2, y2] }` (même définition que CSS). `propsAt`
  calcule les propriétés à un instant ; les animations d'entrée/sortie simples s'ajoutent par-dessus.
- **Animateurs de texte** (`TextOverlay.animator`) : unités lettre, mot ou ligne ; ordre (premier→dernier,
  inverse, depuis le centre, aléatoire déterministe) ; délai entre unités, durée, courbe ; état de départ
  (opacité, décalage en tailles de texte, échelle, rotation, flou) ; sortie en miroir. `animatorAt` donne l'état
  de chaque unité ; `drawAnimatedText` les dessine une à une.
- **Préréglages** (`presets.ts`, `ANIMATION_PRESETS`) : 8 de texte (Words rise, Letters pop, Typewriter, Blur in,
  Lines slide, Words spring, From the centre, Flicker) et 8 de mouvement (Drop in, Zoom in, Spin in, Slow zoom,
  Pulse, Float, Shake, Blur reveal). Ils écrivent des clés ou un animateur ordinaires, donc tout reste éditable.
- Éditeur, panneau d'un calque (`AnimatePanel.tsx`) : préréglages en un clic, animateur de texte, chronomètre par
  propriété (active la piste), ◆ enregistre la valeur au curseur, saut à la clé précédente/suivante, **graphe de
  valeur** (clés à glisser dans le temps et en valeur) et **éditeur de courbe** (deux poignées de Bézier). Les clés
  apparaissent en losanges sur les blocs de la timeline. Lecture tolérante (`schema.ts`) : une clé invalide est
  ignorée seule.
- IA : `animation.presets`, `edit.animate` (préréglage, clés, animateur ou effacement, validés), `edit.addText`.

### Film et variantes (méthode Remotion)

- Un montage issu d'un scénario garde ses **réglages de film** (`EditState.film = { settings, locale }`), comme
  les props d'une composition Remotion. `applyFilm` (pur, testé, `@goscreen/scenario`) les applique à un montage
  existant : format, fond, couleurs, police, place des légendes (masquées = transparentes, jamais perdues),
  zoom des scènes, cartons d'ouverture et de fin. Seul ce qui vient des scènes change (ids `caption-*`,
  `scene-*`, `intro`, `outro`) ; coupes, textes ajoutés, blocs et animations restent.
- Éditeur : panneau **Film** (premier de la barre, visible pour ces montages) : chaque réglage s'applique tout de
  suite, annulable. Les clips de la piste vidéo portent le nom de leur scène et leur durée en images (30 i/s).
- **Variantes** : le même film en 9:16, 16:9, 1:1 et 4:5, chacun mis en page par les règles du film, exporté à la
  suite sans toucher au montage à l'écran (`exportVariants`, panneau Film « Export several formats »).
- L'export hors du dialogue (IA, variantes) passe par `exportCurrent` : une exportation à la fois, garde-fou de
  30 s si la fenêtre est cachée.
- IA : `edit.setFilm` (seulement les champs à changer), `export.variants`, `edit.addMedia` (image, vidéo ou son par chemin absolu),
  `edit.cleanSilences` (pauses d'un son, ou de toutes les voix off et du micro).
- **Rendu « vitrine »** (`film.look = "showcase"`, par défaut, celui des VSL OEUF D'OR) : appareil avec sa coque à
  75 % de la hauteur en 9:16 (à droite en 16:9), au-dessus un sur-titre de chapitre (`film.label` : « ACHETEUR ·
  2/11 », pastille d'accent, JetBrains Mono espacé) et le titre de la scène aligné à gauche, disque d'accent à
  16 % derrière l'appareil (`background.decor`), cartons de marque alignés à gauche (`slide.layout = "left"` :
  pastille et `film.brand`, sur-titre, titre dont les `*mots entre étoiles*` prennent l'accent, sous-titre
  atténué). Les sur-titres (`kicker-*`) sont recalculés à chaque application, jamais édités à part.
  `look = "plain"` garde l'ancienne mise en page (légende centrée, plaque si zoom).
- `adoptFilm` fait d'un montage quelconque un film : premier et dernier cartons = ouverture et fin, le texte qui
  commence avec un clip devient le titre de sa scène. Panneau Film « Make it a film », ou `edit.setFilm` par l'IA.

### Blocs : compositions HTML (méthode HyperFrames)

- Un **bloc** (`@goscreen/blocks`, pur et testé) est une petite page HTML animée **en CSS seulement** : titre
  cinétique, bandeau nom/rôle, compteur, graphique en barres, liste cochée, appel à l'action, étapes, citation,
  phrase surlignée, carte logo (plein cadre, opaque), et les éléments que les prompts partagés demandent le plus :
  courbe qui se trace (`line-chart`), anneau de progression, pastilles, champ qui se tape (`prompt-input`), chat avec
  points de frappe, notification, cartes en éventail, logotype à point (`wordmark`). Chaque bloc déclare ses réglages (texte, texte long,
  couleur, nombre), sa boîte par défaut et sa durée. Les textes sont échappés et les couleurs doivent être `#rrggbb`.
- **Rendu déterministe** (`scenario-runner/compose.mjs`) : Chrome sans fenêtre, réseau coupé ; pour chaque image,
  toutes les animations (`document.getAnimations()`) sont mises en pause et placées au bon instant, puis capture
  PNG -> FFmpeg. Transparence conservée : HEVC avec alpha (`.mov`, ce que WebKit affiche) sur macOS, VP9 alpha
  (`.webm`) ailleurs ; blocs opaques en H.264. Commande Rust `block_render` (dimensions et durée bornées), puis
  `asset_import`.
- Le calque est une vidéo qui garde sa source (`VideoOverlay.source = { block, props }`) : « Edit block… » le rend
  à nouveau avec d'autres réglages, à la même place.
- **Galerie** (bouton Blocks de la timeline, clic droit sur l'aperçu « Add a block here… ») : chaque bloc joue en
  direct dans sa carte (iframe `sandbox`, en boucle), **déjà aux couleurs du film** (accent des touches, couleur
  des légendes pour les blocs dont le texte est posé sur la vidéo) ; formulaire de réglages avec aperçu en
  direct ; ajout au curseur en une modification annulable.
- IA : `blocks.list`, `edit.addBlock`, `edit.updateBlock`.

### Inspirations : prompts partagés dans le processus créatif

- Source : la liste communautaire `yihui-dev/awesome-opus5-5-videos` (MIT, ~700 vidéos faites en code, chacune avec
  le prompt de son auteur). **Jamais embarquée** : téléchargée à la demande (Rust `modules/inspiration/`,
  `inspiration_sync`, contrôle « une liste avec slug et prompt », écriture atomique) dans
  `<data>/goScreen/inspiration/videos.json` ; ensuite tout marche hors ligne. Chaque entrée garde son auteur et
  son post : le film qui suit une inspiration la mémorise (`film.inspiration`, son slug) pour le crédit.
- `@goscreen/inspiration` (pur, testé) : `parseLibrary` (entrée par entrée), `directionOf(prompt)` lit sans IA
  format, taille, durée (celle du film, pas d'un fondu de 0,8 s), i/s, BPM, palette (`#hex` et son rôle d'après
  les mots qui le précèdent), polices, interdits (`Banned:`), techniques, genres et structure
  (`<structure>`, storyboard). Ce qui n'est pas écrit reste vide : sur la vraie liste, 3 % des prompts écrivent une
  palette en hexadécimal, et ces 3 % sont lus ; la durée en ressort pour 23 %, un genre pour 48 %. `filmPatch` -> format, fond, texte, accent (rôles nommés, sinon déduits : contraste
  WCAG pour le texte, saturation pour l'accent), police la plus proche de celles que le canvas sait dessiner
  (`FILM_FONTS`). `search` (mots, catégorie, genres, techniques, format), `genresForRecipe` (recettes de
  campagne -> genres), `briefOf` (Markdown : crédit, direction, structure, interdits, **l'outil goScreen de
  chaque technique** (`GOSCREEN_TOOLS`) et celles qui n'existent pas ici, à ne jamais simuler, puis le prompt).
- Desktop (`modules/inspiration/`) : dialogue **Inspiration** (recherche, catégories, genres, palette, techniques
  et leur outil, structure, interdits, prompt complet ; « Use as direction » = annulable, « Copy brief »).
  Entrées : panneau Film (section Inspiration, « Start from an inspiration… » avant d'en faire un film) et
  chaque proposition de campagne (« Direction ideas… », filtré par les genres de sa recette). Aucune image
  distante (CSP) : la palette tient lieu d'aperçu.
- **Kit d'éléments** (`kitOf`, pur, testé) : une inspiration n'est pas qu'une palette, ce sont aussi les éléments
  graphiques de son prompt, posés dans le montage. Chaque règle (bloc + déclencheur dans le prompt) se remplit de ce
  que le prompt dit : phrases citées (`quotesOf` : ni nom de musique ou de police, ni étiquette de deux mots en
  minuscules ; `[product]` devient la marque du film) et résultats chiffrés (`metricsOf` : seulement cités, listés
  avec « / » ou annoncés comme un compte ; jamais i/s, BPM, px, versions ni consignes comme « 6 ingredients »).
  Chaque phrase sert un seul élément, dans l'ordre du prompt ; les phrases d'action (« Start tonight ») vont à
  l'appel à l'action ; au plus 2 ouvertures, 4 éléments dans les scènes, 1 fin (`kitTimes`). Un lancement, une pub
  ou un film de marque sans rien à citer ouvre quand même sur la marque et finit sur l'appel à l'action. Couleurs
  = celles du film une fois l'inspiration appliquée ; texte posé sur l'accent = encre ou fond, celui qui se lit.
  **Les textes parlent du produit de l'auteur** : ils montrent la forme, à réécrire (l'IA passe `props` par
  élément). Sur la liste : ~15 % des prompts donnent des éléments (les autres sont des jeux, de la 3D ou une
  description). Desktop : section Elements du dialogue (aperçu vivant, cases à cocher, « Add N elements », une
  modification annulable, rendu ~6 s par élément).
- IA : `inspiration.sync`, `inspiration.search` (`recipe` possible), `inspiration.brief`, `inspiration.apply`,
  `inspiration.kit`, `inspiration.addElements` (`pick`, `props` par index pour réécrire les textes).
  La skill fait choisir une direction avec la personne avant de créer, puis la suivre (interdits compris).
- Relevé sur la liste (2026-10-17) : la technique structurante la plus fréquente est le **calage sur le tempo**
  (« 120 BPM, something happens on every beat », 41 prompts) ; puis `seek(t)` pur et ressorts en forme close
  (déjà la méthode de goScreen), flou de mouvement par sous-images (`tmix`, 28), curseur qui pilote l'interface,
  zoom façon Screen Studio. Manquent ici : calage sur le tempo, flou de mouvement, grain (voir « À faire »).

### IA aux commandes (MCP, CLI, skill)

Une IA (Claude ou tout client MCP) pilote goScreen avec **les mêmes commandes que les boutons**, sur les mêmes
données ; la personne voit tout et garde la main (⌘Z annule une modification de montage faite par l'IA).

- **Commandes typées** (`modules/control/`) : `defineCommand({ name, title, description, input: zod, destructive })`,
  validées avant de tourner, publiées en JSON Schema (`control.catalog`). Familles : `app` (état, afficher un
  écran), `devices`, `projects`, `vsl` (lire, créer, enregistrer le flow validé, valeurs), `site.inspect`,
  `tasks` (simuler, tourner, attendre, arrêter), `edit` (lire, enregistrer, reconstruire le montage), `export`
  (exporter, arrêter), `help.formats`. Une modification sur un flow ou un montage ouvert s'affiche aussitôt.
- **`site.inspect`** : le runner ouvre la page sur l'appareil émulé (ou l'état après un parcours jusqu'à un
  nœud) et rend le titre, les intertitres, le texte visible, les iframes et chaque élément actionnable avec
  une cible vérifiée (`inspect.mjs`, mêmes fonctions que l'enregistrement en direct), plus une capture.
- **Serveur de contrôle** (Rust, `modules/control/`) : 127.0.0.1 seulement, port libre, jeton 128 bits dans
  `<config>/goScreen/control.json` (0600) ; toute requête avec un en-tête `Origin` (une page web) est refusée.
  Une requête devient l'événement `control-request` ; le studio l'exécute et répond par `control_reply`
  (30 min au plus, pour attendre un tournage).
- **`packages/mcp-server`** (Node, sans dépendance) : `server.mjs` (MCP stdio : `initialize`, `tools/list` tiré
  du catalogue de l'app, `tools/call` ; les points deviennent `_` ; captures rendues en images ; app fermée =
  erreur d'outil lisible) et `cli.mjs` (`goscreen <commande> '<json>'`). `node:http` et pas `fetch` (qui
  abandonne après 5 min). Testés de bout en bout contre un faux serveur.
- **Skill routeur** `skills/goscreen/SKILL.md` : court, il dit quel sous-document charger selon la tâche, plus
  deux règles valables partout (aperçu d'abord, export sur demande explicite ; `edit.get` juste avant tout
  `edit.save`, ne jamais écraser le travail de la personne). Sous-documents : `workflow.md` (inspecter,
  s'accorder, créer par petites étapes, planche de stills avec `edit.frame`, corriger, révisions une à la fois,
  table QC avant export, chiffres réels dans le compte rendu), `rules.md` (barre de qualité : formats 9:16 /
  16:9 / 1:1 / 4:5 avec zones sûres et tailles minimales en fractions du cadre, ouverture qui montre la promesse
  dès l'image 1, ≤ 6 mots par ligne et un accent, courbes jamais linéaires (`out`, `bezier(0.16,1,0.3,1)`),
  entrée = montée + fondu et sortie plus courte, « hero then place », zooms ≤ 1,15 environ toutes les 4 s,
  gris foncés jamais noirs, un accent à la fois, vrais logos seulement, un chiffre dit = `stat-counter`, prises
  face caméra coupées sur les mots, liste d'interdits (pulse, bounce, elastic, glow > 0,12, néon, logo
  d'ouverture, fondu enchaîné sur place…) et la checklist en 12 points à relire sur chaque planche de stills),
  `script.md` (une idée par vidéo, structure hook → produit → solution → 2-3 fonctionnalités chiffrées → CTA,
  longueur = mots ÷ 2,3, hook ≤ 3 s, 4 portes de qualité, ouvertures interdites), `vsl.md` (projets, flows,
  étapes, cibles, simuler, tourner), `editing.md` (chaque commande `edit.*`, blocs, animation, film,
  inspirations, avec un exemple JSON conforme à `commands.ts`). La règle « un seul élément animé par scène »
  a disparu : chaque beat est une action. Les commandes prévues ailleurs (`edit.stills`, `edit.preview`,
  `edit.addComposition`, `edit.versions`, `edit.diff`, `edit.restore`, `edit.transcribe`, `edit.pickTakes`,
  `edit.tightCut`, `edit.syncMap`, `edit.faceZooms`, `edit.captions`, `edit.qc`) sont citées dans « If
  available » : à utiliser si `control.catalog` les liste, sans en dépendre.
- **Montages de référence** `skills/goscreen/references/` : trois `.edit.json` écrits à la main avec le
  vocabulaire réel (`ad-9x16`, pub produit 22 s ; `launch-16x9`, lancement 47 s ; `proof-1x1`, preuve chiffrée
  19 s), la barre de qualité qu'une IA ouvre et imite (jamais ses mots). `layers: null` pour qu'ils s'ouvrent
  sur n'importe quelle prise ; le README dit la prise attendue (format, durée) et ce qu'un fichier statique ne
  porte pas (blocs rendus par montage, sons). `references.test.ts` (render-engine) vérifie que
  `parseEditState` les accepte sans perdre un champ.
- **Évals** `packages/skill-evals/` (Node, sans dépendance ; `pnpm evals`) : `scenarios.mjs` (pub 9:16 avec
  trois phrases imposées, lancement 16:9, preuve 1:1, explainer avec voix, VSL d'un site public), `run.mjs`
  (l'app ouverte : donne le scénario à Claude par `claude -p` si la CLI existe, sinon imprime le prompt et
  attend ; puis `edit.get` par `mcp-server/client.mjs` et note ; `--score-only <fichier>` note un `.edit.json`
  seul), `score.mjs` (pur, testé) : durée dans la fourchette, format, un changement visuel ≤ 1 s, ≤ 6 mots par
  ligne, un accent par légende, aucune courbe linéaire ni overshoot, zooms ≤ 1,15, aucun trou > 4 s sans
  mouvement, jamais deux effets à moins de 0,2 s (le kicker d'un titre excepté), CTA final, phrases imposées
  présentes, dernière carte = première quand le film est annoncé en boucle. Les trois références passent.
- Studio : pastille « Connect an AI » en bas à gauche (état, commandes prêtes à copier pour Claude Code, Claude
  Desktop et la CLI, journal de ce que l'IA a fait).
- L'export suit la fenêtre : `backgroundThrottling: "disabled"`, la fenêtre passe au premier plan, et un
  export qui n'avance plus pendant 30 s s'arrête avec un message clair (macOS ne charge pas la vidéo d'une
  fenêtre cachée).

### Animation par le temps (méthode Remotion, sans dépendance)

Remotion n'est pas sous MIT : on reprend sa méthode, pas sa bibliothèque. Chaque valeur animée est une
fonction pure du temps (`keyframes.ts`) : `interpolate(t, entrées, sorties, { easing, extrapolate… })` et
`spring(t, { mass, damping, stiffness, overshootClamping })` (ressort amorti en forme close, donc n'importe
quelle image se calcule seule, dans n'importe quel ordre : aperçu, déplacement dans la timeline et export
dessinent la même image). L'animation d'entrée `spring` des textes s'en sert ; un montage est construit à
partir de données (scénario + `film`), comme une composition Remotion à partir de ses props.

### Reproduire une vidéo de référence (motion specs, IA locale)

- Une **référence** = un dossier `<Vidéos>/goScreen/References/<id>/` (Rust `modules/motion/`) : la vidéo source,
  les mesures (`*.observations.json`, `scenario-runner/analyze.mjs` : coupes, mots OCR minutés, couleurs,
  soulignés), la spec (`spec.json`, plus `spec.auto.json` telle que dérivée) et ses rendus (`render-N.mp4` +
  `.report.json`). Le studio n'envoie que des ids et des noms de fichiers, jamais de chemin (sauf la vidéo choisie).
- `@goscreen/motion` (pur, testé) : `specFromObservations` (plans entre les coupes, lignes, taille, accent,
  barré, sans IA) -> `specHtml` (une page autonome, une Web Animation par élément, rendue par `compose.mjs`) ->
  `measureShots` + `fidelity` (le rendu repasse par le même analyseur : on compare des mesures entre elles).
- **Minutage exact** : toute image est extraite avec `fps=N:round=up` (l'image affichée à cet instant ; l'arrondi
  par défaut de FFmpeg rendait jusqu'à une demi-période plus tard : l'échantillon de 4,5 s montrait le plan de 4,6 s).
- **Fond de plan** (`plates`, `reference.plate-N.png`, un par coupe) : médiane, pixel par pixel, de 24 images
  réparties sur la coupe, sans les zones des mots dessinés (`makePlate`) ; un pixel libre dans moins de la moitié
  des images est comblé depuis ses voisins (pyramide push-pull). Dégradés, trames et ombres fixes y sont nets. Le
  rendu le pose sous tout le plan (`shot.plate`, sur la couleur `background`).
- **Éléments visuels** = ce qui **diffère du fond de plan** (pixel par pixel, `visualsOf`), sans les mots dessinés
  pendant toute leur présence, entrée floue comprise (`wordArea`). Partout où une image s'écarte du fond, il y a
  donc une découpe des vrais pixels à son moment. Chaque découpe **grandit jusqu'à ce que son bord soit du fond**
  (`growToBackground` : un halo, une ombre douce ne sont jamais coupés en rectangle). Suivi d'un échantillon à
  l'autre (`trackVisuals`, depuis la dernière place) ; un élément englobé par une nouvelle forme (halo) est tenu un
  échantillon ; vu une seule fois, il est écarté. Stable : une image (`reference.visual-N.png`, son aspect habituel
  au repos : vignette médiane, lectures tardives) qui suit sa trajectoire mesurée ; animé à l'intérieur
  (interface) : un **clip** VP9 de sa zone (`.webm`), sans fondu ajouté, démarré un échantillon plus tôt.
- **Mots** : `masked` (dessinés par le rendu, donc hors des images) = assez grands (`BIG_WORD`), pas un lettrage
  de logo (`mark`, lettres très espacées), lus au moins deux fois avec 65 de confiance (`isReliable`, même règle
  que `cleanWords`) ; un mot lu une fois ou peu sûr reste dans l'image avec ses vrais pixels. Deux mots qui se
  suivent au même endroit (compteur, titres en fondu) restent tous les deux. Couleur = lecture la plus éloignée
  du fond (`sharpestColor`), accent jugé à la chroma ; un mot commence au plus tard à sa première lecture et
  appartient à la coupe où il est posé.
- Dans la spec : `shot.visuals` (derrière le texte). La décision texte / image se prend par groupe de mots (un
  groupe posé sur une image bien plus grande que lui, `onPicture`, appartient à l'image). **Plan texte** : ses
  lignes sont les mots dessinés (les petits restent dans les images) ; chaque ligne a sa taille et sa ligne de
  base mesurées (`Line.size`, `Line.y`), chaque mot sa place et la largeur de son encre (`Word.x`, `Word.w` :
  interlettrage via `measureText`), le barré est posé sur ses lettres et démarre un échantillon avant d'être vu ;
  un visuel fait surtout des mots du plan (ou un morceau de soulignement) est écarté. **Plan non textuel** :
  `labels` pour chacun de ses mots dessinés (calés sur l'encre ; un mot court est mis à l'échelle plutôt
  qu'espacé). Les visuels gardent des **caches** (`covers`, couleur relevée autour du mot, bords adoucis) sur les
  mots redessinés par-dessus.
- **Compteurs** : un nombre stable précédé, au même endroit, de nombres plus petits lus une seule fois (trop
  rapides pour l'OCR) devient un compteur (`counterOf` : `count: { from, start, end }` sur un mot ou un label,
  vitesse tirée des lectures) ; le rendu réécrit son nombre à chaque image (`__goscreenSeek`). Les images de ses
  chiffres qui défilent sont écartées. Les boîtes des mots sont resserrées sur leur encre (`inkBox` : l'OCR gonfle
  celles des très gros caractères), les mots et labels suivent leur trajectoire mesurée (`path`, échelle tirée de
  la largeur), et un mot d'une autre encre que celle du plan garde sa couleur (`Word.color`).
- **La note ne ment pas** : chaque échantillon garde une miniature couleur 48 × 48 (`thumbs`) ; `lookAlike`
  compare référence et rendu case par case (« Looks alike ») et `fidelity` ne la dépasse jamais.
- `compose.mjs` sert ces fichiers par nom seulement (`http://goscreen.assets/<nom>`, `assetName`, avec `Range`
  pour les clips) et attend que chaque clip ait l'image voulue avant la capture (`__goscreenSeek`). Les plans
  non textuels sont notés sur leurs images (`visuals` : part de la surface des images de la référence que
  celles du rendu couvrent aussi, sur une grille, tous les quarts de seconde ; un logo trouvé en 16 morceaux
  d'un côté et 6 de l'autre reste comparable). Une référence mesurée avant cette version doit être ré-analysée.
- **Relecture** (`review.ts`) : une IA regarde une image par plan et corrige ce que l'OCR ne sait pas (texte
  exact, accents, mots mis en avant ou barrés, nature d'un plan qui n'est pas du texte). Le minutage et la mise
  en page restent mesurés, l'IA ne les invente jamais. Même contrat (`ShotReview`) pour tous les modèles.
- **Modèle local** (Rust `modules/local_ai/`) : `llama-server` (llama.cpp) avec Qwen3-VL 2B/4B/8B, téléchargé une
  fois dans `<data>/goScreen/models/`, sur 127.0.0.1 derrière une clé aléatoire ; réponses en JSON Schema.
  Rien ne quitte la machine.
- **Professeur / élève** (`training.ts`, Rust `local_ai/training.rs`) : chaque réponse d'un professeur (Claude par
  MCP, `motion.teach`, ou une personne) devient un exemple `<data>/goScreen/training/examples/<id>.json` + `.jpg`
  (image, question, réponse de l'élève s'il en avait donné une, réponse du professeur). Avant chaque question, le
  modèle local reçoit les exemples les plus instructifs (`pickExamples` : ses erreurs d'abord, même référence,
  plus récents) en few-shot ; `agreement` suit son accord avec le professeur (global et 20 derniers) ;
  `training.export` écrit `train.jsonl` (format chat avec images) pour un LoRA, utile à partir de
  `FINE_TUNE_MIN_EXAMPLES` (200). Toute nouvelle étape assistée par IA doit suivre ce contrat.
- IA : `motion.references`, `motion.create`, `motion.spec`, `motion.setSpec`, `motion.frame`, `motion.shot`,
  `motion.teach`, `motion.reviewLocal`, `motion.render`, `training.stats`, `training.export`
  (`modules/motion/commands.ts`). `motion_video_url` sert une référence ou un rendu par le serveur média.
- **Contrat d'apprentissage** (`ShotReview`) : en plus du type, du texte et de la description, le **fond**
  (`background` : uni, dégradé, texture, vidéo, image, et ses couleurs) et les **éléments** (`elements` : rôle carte,
  fenêtre, pastille, bouton, logo, icône, photo, graphique, liste ; ombre ; libellé). Chaque test d'une référence
  dans l'app se termine par la boucle d'apprentissage : `motion.reviewLocal` (l'élève répond), puis
  `motion.teach` plan par plan (le professeur corrige, l'exemple est gardé). Pas encore utilisés par le rendu :
  le fond et les éléments sont appris pour la suite (choisir un bloc, faire confiance au fond de plan).
- **Suivre l'IA** couvre aussi la reproduction : `motion.create` ouvre l'accueil Reproduce puis la page de la
  nouvelle référence dès qu'elle existe, avec sa progression ; `motion.render` vise « Render and compare », puis
  attend sur la progression et montre la note ; les commandes d'un plan le sélectionnent. Le travail lancé par
  l'IA bloque les boutons de la page (`job`).
- **Ouvrir dans l'éditeur** (bouton « Open in editor », IA `motion.openInEditor`) : une vidéo reproduite devient
  un montage de calques, écrit à côté de son dernier rendu (`render-N.edit.json`, fichiers dans
  `render-N.assets/`). `specToEdit` (pur, testé, `@goscreen/motion`, accepté tel quel par `parseEditState`) : une
  diapositive par plan (sa couleur), le fond de plan et chaque découpe en calque image ou vidéo avec sa
  trajectoire en images clés et ses fondus, chaque suite de mots d'une même encre en calque texte (mots qui
  entrent un à un), le soulignement en forme, chaque compteur en **bloc `stat-counter`** (valeur et couleur
  réglables, rendu par l'app). Tout se change, se réutilise dans une autre vidéo ou se complète avec les
  commandes `edit.*`. Les caches ne passent pas (une forme `rect` n'est qu'un contour).
- **Corriger sans perdre les mesures** (`applyReview`) : chaque ligne corrigée retrouve la ligne mesurée qui
  partage le plus de mots, chaque mot sa mesure (place, largeur, couleur, compteur, minutage) par son texte ;
  une ligne que le professeur a vue mais qui n'a pas été mesurée (une pastille dans une image) est apprise,
  pas dessinée.
- **Modèle local gardé en marche** : l'app retient le modèle démarré et le relance au lancement et avant
  chaque question à l'élève (`ensureLocalModel`) ; il s'arrête sinon avec l'app.
- **Écran Reproduce** (`/reproduce`, bouton « Reproduce a video » de l'accueil ; `/reproduce?reference=<id>`) :
  références en cartes (création = choisir une vidéo, mesure, première spec). Page d'une référence : la vidéo et
  un rendu côte à côte sur une seule horloge (`compare.ts` : la référence mène, le rendu suit à 80 ms près ;
  Espace), bande des plans colorée par fidélité (vert ≥ `FIDELITY_PASS`, orange ≥ 0,6, rouge), liste des plans,
  et pour le plan choisi : son image et la spec dessinée à la même place (position, taille, interligne,
  accent, barré), les écarts mesurés, la dernière réponse du modèle local et la **correction** d'une personne
  (`correction.ts`, pur et testé : une ligne par ligne, `*mot*` accent, `~mot~` barré), qui réécrit la spec et
  devient un exemple (`teacherName: "person"`). Dialogue **Local model** : télécharger, démarrer, arrêter un
  Qwen3-VL, ce qu'il a appris (exemples, accord global et sur les 20 derniers), export du jeu d'entraînement.
  IA : `app.show` avec `view: "reproduce"`.

### Montage façon pub SaaS (cours Ultimate Editors 2.0)

Relevé le 2026-10-20 sur les 25 h du cours (modules SaaS : théorie, fonds, textes, clics, UI, 3D,
transitions, tests ; masterclass Devin Jatho : hooks, textes, UI). Les techniques AE sont réécrites en
fonctions pures du temps ; les notes détaillées (chiffres, timecodes) sont rangées à côté du cours
(`_notes-goScreen/`). Rien de ce qui suit ne touche la capture : tout s'applique au montage.

- **Règles retenues** : structure hook → intro produit (chiffre de preuve) → solution à l'écran → 2-3
  fonctionnalités chiffrées → CTA très court ; script de 60-80 mots ≈ 30 s, une phrase par scène, la coupe
  tombe sur l'attaque de la phrase suivante ; ≤ 5-6 mots à l'écran, un mot accentué par phrase ; jamais de
  courbe linéaire (« sharp » : vitesse max au départ, longue décélération ; rebond 4 images + 25-30 %) ; un
  mouvement ne s'arrête jamais net (dérive, zoom qui continue) ; stagger de 1-2 images ; gris foncés plutôt
  que noirs, une famille de teintes désaturée, glow minuscule ; « plus c'est loin du sujet, plus c'est flou ».
- **Vocabulaire du moteur** (`render-engine/look.ts`) : `sharp`, `sharpOut`, `pop(t, amplitude)` (ressort
  réglé sur 4 images à 30 i/s), `entranceAt`, `driftAt`, `projectRect` (perspective pinhole, focale 1,3 × le
  grand côté), `insideQuad`. Les `PlacedLayer` portent leur quad projeté : touches, curseur et clic droit
  passent par l'homographie.
- **Écran « premium »** (`EditState.screen`, `PREMIUM_LOOK`, panneau Devices → Screen look) : plaque givrée
  et contour (fixe à 50 % ou dégradé qui tourne de 90° à 19° sur la scène) autour d'un verre sans cadre,
  inclinaison trois-quarts (x 8°, y −10°) avec dérive de 3° sur la scène, profondeur de champ (bord lointain
  flou), entrée de scène en « pan in » depuis le bas (0,6 s, courbe sharp). Une scène = un clip qui ouvre une
  nouvelle vue (`sceneTimeAt`). Le dessin passe par un petit programme WebGL (`editor/warp.ts`) : le device est
  peint à plat dans un bitmap puis plaqué sur son quad avec un flou par profondeur ; repli 2D sans WebGL.
- **Caméra à élan** (`camera.ts`) : entrée de zoom sharp (0,5 s), sortie douce (0,7 s), plateau qui pousse
  encore de 4 % (`ZOOM_DRIFT`), glissement d'un clic au suivant en sharp.
- **Clics** (`touches.ts`) : style `ripple` (disque d'appui + deux anneaux flous à 2 images d'écart qui
  grandissent et s'effacent en 0,5 s), **punch** de l'écran à chaque clic (creux de 2 % et rebond amplitude
  50, `pressPunch`), curseur réduit d'un cinquième à l'appui, **spotlight** (`touch.spotlight`) : le reste
  s'assombrit 1,3 s autour du clic.
- **Fonds cinématiques** (`background.ts`, `EditBackground.kind = "mesh"`) : `circles` (neuf disques d'une
  famille de teintes sur un cadre 2× plus grand, rotation 20°/s × vitesse, flou 0,14 × petit côté), `blob`
  (tache asymétrique qui respire à 0,5 Hz), `waves` (trois bandes, la plus lointaine la plus floue, dérive
  0,1 Hz) ; grain **fixe** (une tuile, jamais régénérée) 6 %, vignette. `meshPalette(accent)` : base très
  sombre de la même teinte, cinq tons désaturés. Peint en 1/6 de résolution puis agrandi.
- **Transitions** : `blur` (fondu qui devient flou à la coupe, 30 px à 1080p, net quelques images avant et
  après) et `push` (le plan sortant accélère vers l'avant, l'entrant atterrit de plus loin en sharp) ;
  les glissements utilisent la courbe sharp et accumulent trois sous-images (flou de mouvement).
- **Textes** (`TextStyle.accent/flash/sweep/glow/shadow`, panneau Text → Emphasis) : `*mots*` accentués
  (dégradé clair de l'accent, graisse 900, +12 %), flash de deux couleurs à l'entrée (3 images par palier),
  balayage lumineux en 0,9 s, glow qui culmine à 0,45 s puis décroît, dégradé vertical léger sur les mots
  de base, ombre portée dure en bas à droite. Les légendes de scénario l'utilisent, et `starNumbers`
  accentue leurs chiffres.
- **Flou de mouvement à l'export** : `frameMoves` (caméra, écran incliné ou entrant, transition, calque
  animé) ; les images qui bougent sont la moyenne de trois instants, les autres restent nettes.
- **La voix mène la coupe** (`@goscreen/scenario` `voice.ts`, `alignScenesToVoice`, bouton du panneau d'un
  son, IA `edit.alignToVoice`) : la scène i dure de l'attaque de la phrase i à celle de la phrase i+1 ; une
  scène trop courte ralentit (plancher 0,6×) ; légendes et kickers suivent. Les phrases viennent de la
  détection de silences (`soundRanges`, phrases séparées de plus de 0,35 s).
- **Film** : `screen: "framed" | "premium"` et `backdrop: "flat" | "circles" | "blob" | "waves"` dans
  `filmSchema` ; `applyFilm` pose le look, le cadre, le style de clic et le spotlight ensemble (panneau Film :
  Screen, Backdrop). IA : `edit.setFilm` les accepte ; la skill propose le look premium pour un spot produit.
- **Regarder sans exporter** : `edit.frame` (IA, CLI) dessine une image du montage à un instant avec le
  moteur d'export et la rend en JPEG ; c'est ainsi que ces tranches ont été vérifiées. Les médias d'un
  export sont chargés avec une limite de 10 s (un `.mov` qui ne se décode pas est ignoré au lieu de geler
  l'export) ; WebKit ne charge que quelques éléments vidéo à la fois, d'où des chargements lents quand la
  preview et les stills sont actifs.
- **Comparaison avec claude-code-video-toolkit (2026-10-20, site OEUF D'OR)** : le toolkit (Remotion) compose
  des cartes narratives (titre, problème, solution, démo, chiffres, CTA) autour d'une capture Playwright jouée à
  plat, et chaîne voix de synthèse, musique et sous-titres si des services sont configurés ; goScreen tient la
  capture (appareil, perspective, zooms, clics, légendes de scène, fond animé) et peut reprendre une vidéo faite
  ailleurs comme un seul verre. Ce qui manque à goScreen pour un spot complet sans prompt : la **structure
  narrative automatique** (problème → solution → chiffres → CTA tirés du site, en cartes et blocs), la **voix
  de synthèse** et une **musique** calées sur le montage, des **sous-titres** mot à mot, des scènes qui se
  **ressemblent moins** (alterner fond sombre / clair, zoom serré sur un élément, carte flottante), et un
  ciblage de défilement plus sûr (un libellé présent dans la navigation et dans une section).
- **Sans prompt, depuis le site** : `edit.propose` (IA, CLI) lit la marque et les sections du site derrière la
  prise ouverte, construit les huit propositions du catalogue de recettes et en applique une (cartes hook,
  nom, parcours, CTA ; plans légendés) ; les montages de campagne portent maintenant le look premium, un fond
  animé aux couleurs de la marque (selon le ton : `circles`, `blob`, `waves`), les clics en anneaux et les
  légendes accentuées. Les scènes alternent le côté vers lequel l'écran se tourne (`SceneTime.index`). Le
  runner fait défiler vers une section plutôt que vers le lien de navigation du même nom.
- **À faire (relevé par le cours, pas encore fait)** : calage sur le tempo de la musique ; shatter / shine
  avancés ; recadrage « éléments flottants » (un élément d'UI découpé qui pop hors de la capture) ; objets
  3D (pièces, logos extrudés) ; voix de synthèse (le cours utilise ElevenLabs : voix « Advertisement »,
  stability 40) ; mots-clés de la voix (ASR) pour déclencher les entrées de texte sur le mot, pas seulement
  la scène ; vérification visuelle du look premium sur une prise longue (l'export exige la fenêtre visible).

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
- Lecture : chaque média suit l'horloge de la timeline (`followMove`, `drift.ts`, pur et testé). Une dérive
  de moins d'une seconde se rattrape en jouant jusqu'à 10 % plus vite ou plus lentement, sans saut ; au-delà,
  le saut vise où sera la timeline une fois le saut fini (durée du dernier saut mesurée par élément), jamais
  pendant un saut ni dans la seconde qui suit. Chaque saut redécode depuis l'image clé précédente : il fige
  l'image, et un saut qui arrive en retard en appelle un autre.
- Encodage des prises (écran, scénario, caméra, découpe) : une image clé par seconde
  (`-force_key_frames expr:gte(t,n_forced*1)`, `KEYFRAME_EVERY_SECOND`) ; avec le défaut de x264 (une toutes
  les ~8 s), chaque saut de la preview figeait l'image le temps de décoder jusqu'à 250 images.
- Les clips audio (voix off générée ou enregistrée, musique) ne passent pas par un élément `<audio>` dans la
  preview : chaque fichier est décodé une fois et programmé sur l'horloge Web Audio (`voices.ts`, plan pur et
  testé dans `voicePlan.ts` : départ, décalage dans le fichier, fondus et volume comme à l'export). Un `<audio>`
  lu en flux depuis le serveur média calait et laissait des blancs. Seule la voix détachée du micro garde un élément.
  La vidéo est servie par un serveur média local (Range + CORS) pour que le canvas ne soit pas « tainted ».
- Serveurs locaux de l'app (média, flux Android) : URL à jeton aléatoire 128 bits, CORS limité à l'origine
  du studio, toute autre `Origin` refusée (`local_http.rs`). Les sites prévisualisés vivent aussi sur 127.0.0.1.
- Export : seek frame par frame -> JPEG (q 0,98) -> `export_frame` (corps IPC brut) -> FFmpeg (x264 slow, CRF 15,
  conversion explicite en BT.709) ; second passage pour
  mixer les sons de tap synthétisés. Sortie `~/Movies/goScreen/<nom>-export-<stamp>.mp4`.
- `buildAutoZooms` (render-engine) propose des zooms à la première ouverture : un segment par rafale de clics
  (arrivée 0,6 s avant, départ 1,4 s après, ×1,8, caméra qui suit le pointeur) ; le scroll et les simples
  mouvements ne zooment jamais. Bouton « Auto zoom on clicks » du panneau Zoom pour régénérer (annulable).
- Curseur synthétique (`cursor.ts`, `edit.cursor`) : flèche dessinée depuis les mouvements enregistrés (survol
  compris), lissée sur 120 ms, posée exactement sur chaque clic et réduite pendant l'appui. Visible par défaut ;
  panneau « Cursor & clicks ».

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

### Interface façon Premiere / After Effects

- **Espaces de travail** (en haut à droite : Editing, Animation, Film, Audio) : mêmes panneaux, tailles et onglets
  propres à chacun (`workspace.ts`, tailles mémorisées par espace).
- **Projet** (`ProjectPanel.tsx`) : chutier des médias (l'enregistrement + `edit.assets`, double-clic ou glisser
  sur la timeline), Blocks (galerie vivante), Effects (animations de texte, mouvements, transitions, titres,
  formes, flou : double-clic applique), Scenes (clips de la piste vidéo, clic = aller à).
- **Program** : moniteur avec timecode `HH:MM:SS:FF`, format, résolution de lecture, durée ; transport image par
  image, coupe, voix off. **Effect Controls / Film / Look / Audio / Assistant** à droite (`Panels.tsx`).
- **Timeline** : outils en colonne (sélection V, cutter C, main H, texte T), pistes V1 (vidéo), V2… (calques),
  Zoom, A1… (micro, sons) avec une piste audio vide toujours présente, barre d'état qui explique l'outil.
  Raccourcis J/K/L en plus d'Espace.
- **Voix off** (`voiceover.tsx`, Rust `media/voiceover.rs`) : bouton micro d'une piste audio, du moniteur ou du
  panneau Projet. Décompte 3-2-1 pendant lequel le micro démarre (FFmpeg avfoundation, `-progress` donne
  l'avance du fichier), puis la timeline joue haut-parleurs coupés jusqu'à Stop, Espace ou la fin ; Échap
  annule. La prise est nettoyée par la même chaîne que la voix du studio (`VOICE_CHAIN`), copiée dans
  `<stem>.assets/`, posée au point de départ (`in` = avance du fichier) : volume, fondus, coupe et déplacement
  comme tout son.
- **Capture du micro native** (`media/mic.rs`, cpal sur CoreAudio, WAV 32 bits flottant mono) : FFmpeg 8.1
  (avfoundation) perdait environ 12 % des échantillons sur ce Mac, même micro seul ; `aresample=async=1` les
  remplaçait par des trous de 70 à 90 ms par seconde, d'où une voix hachée et incompréhensible. Voix off et
  narration du studio passent maintenant par cette capture (test `keeps_every_sample`, ignoré par défaut car il
  faut un micro : 7,912 s d'horloge pour 7,925 s enregistrées). Au studio, le WAV est recalé sur la caméra
  (`shift_filter` : `adelay` ou `atrim`) en devenant `<stem>.mic.m4a`, l'`offsetMs` unique ne change pas.
  FFmpeg ne garde que la caméra et le nettoyage (`-ac 1` : le WAV mono nomme son canal « FL », refusé par l'AAC).
- **Choix du micro** : menu « Best microphone » à côté du bouton du panneau Projet (mémorisé à part du studio).
  Avant chaque prise, chaque micro est écouté 0,8 s (`microphone_level`) dans l'ordre : choisi, intégré, autres,
  virtuels (Teams, Zoom, BlackHole…) en dernier ; le premier qui entend plus de -85 dB enregistre. Si tous sont
  muets, c'est macOS qui retient le micro : le message nomme l'application à autoriser
  (`responsible_app_name`) et ouvre le réglage.
- **Autorisations en développement** (`dev_privacy.rs`, debug macOS seulement) : lancé par Portly ou un terminal,
  goScreen se relance une fois « désolidarisé » (`responsibility_spawnattrs_setdisclaim`) pour que macOS demande
  micro, caméra et écran au nom de goScreen (son `Info.plist` est embarqué), comme l'application finale. Sans cela,
  macOS interroge Portly, qui ne déclare pas le micro et reçoit du silence sans fenêtre de demande.
- **Silences** (`silences.ts`, pur et testé ; Rust `media/silence.rs`, `silencedetect`) : dans les contrôles d'un
  son, « Remove pauses » découpe le clip autour de chaque pause et « Trim silent ends » ne coupe que l'attente
  avant le premier mot et après le dernier. Les morceaux gardent leur temps, la voix reste calée sur l'image.
  Seuil et durée de pause réglables ; longueur minimale d'un son jugée avant la marge. Chaque prise de voix off
  est rognée à ses bouts automatiquement. Marche aussi sur la piste Mic d'un enregistrement.

### Onglets et IA visible

- **Onglets** (`modules/tabs`) : chaque onglet garde un lieu (accueil, projet, flow, vidéo, studio) ; naviguer
  déplace l'onglet actif, ⌘T en ouvre un, Ctrl+Tab / ⌘1…9 pour passer de l'un à l'autre, clic milieu ferme,
  clic droit dupliquer / fermer les autres, glisser pour réordonner. Restaurés au lancement (`localStorage`) ;
  les montages vivent sur disque (sauvegarde forcée en quittant l'éditeur). « Open in new tab » sur les VSL et
  vidéos d'un projet.
- **Suivre l'IA** (bouton Follow, en haut à droite) : chaque commande ouvre son lieu dans un onglet
  (`openPlace`), un curseur orange « AI » (`aiCursor.tsx`) glisse vers ce qui va changer (`data-ai` sur les
  panneaux, `data-ai-item` sur les éléments de timeline), « clique », puis montre le résultat : l'élément créé,
  ou chaque nœud ajouté ou modifié d'un flow (`aiStage.ts`). L'IA reçoit sa réponse avant cette mise en scène.
  Les mises en scène passent une à la fois, dans l'ordre des commandes. Le curseur vise la partie visible de sa
  cible (fenêtre et ancêtres qui coupent), l'amène d'abord à l'écran (défilement, ou le flow se centre sur le
  nœud : `addRevealer`), puis se recale si la page a bougé pendant son déplacement ; après une commande, il
  attend que le résultat soit affiché (élément créé, flow rechargé) avant de le montrer.

## Vérifications

- Frontend : `pnpm -r check-types`, `pnpm -r test`, `pnpm lint`
- Rust : `cd apps/desktop/src-tauri && cargo test` (via `portly temp`)
- **Reproduction : tout test passe par goScreen.** `pnpm reproduce:app <vidéo>` (via `portly temp`, l'app lancée
  par Portly) pilote l'app avec les commandes des boutons (`motion.create`, puis `motion.render`), note chaque
  plan et laisse la référence dans l'écran Reproduce pour la regarder côte à côte ; code 1 si un plan reste sous
  `FIDELITY_PASS`. Redémarrer `goScreen/desktop` avant, après un changement de `@goscreen/motion` (les commandes
  gardaient sinon l'ancienne version). `pnpm bench:reproduce <vidéo>` joue la même boucle sans l'app, pour
  itérer entre deux tests ; il donne les mêmes notes. Toujours regarder aussi les images côte à côte : une note
  haute a déjà caché des défauts visibles.
- Bases de test (2026-10-13, par l'app, note honnête « Looks alike ») : `presentation.mp4` (36 s, texte
  cinétique, interfaces, logo) 0,878 et 12/18 ; `p_18r29XIlNmB9xA.mp4` (47 s, 1:1, compteur, mosaïque, dégradés,
  cartes à ombre, pastilles) 0,909 et 3/4.
- **À faire** (relevé par ces tests) :
  - éléments réutilisables, suite : le compteur est un bloc ; reconnaître aussi pastille, bouton (`cta-button`),
    carte, fenêtre, liste (rôles appris par le modèle local) ; une **bibliothèque d'éléments** partagée entre les
    vidéos (aujourd'hui les calques vivent dans `render-N.assets/`) ; regrouper les 150+ calques d'un plan
    d'interface (un groupe par plan) pour que la timeline reste lisible ;
  - « Looks alike » montre les plans encore loin : textes de `presentation` (fonte et anticrénelage d'Inter
    face à la fonte d'origine, 0,76 à 0,81), carton de fin de la nouvelle vidéo (puces et bouton, 48 % d'images) ;
  - fond de plan d'une coupe qui change sans coupure franche (un logo arrivé sur un fond uni reste autour des
    mots d'avant) ;
  - titres en fondu enchaîné : un mot peut manquer pendant la transition ;
  - le fond et les éléments appris par le modèle local ne servent pas encore au rendu.
  - inspirations : détecter le tempo d'une musique (grille de temps) et caler coupes, cartons et entrées de blocs
    dessus (« beat-sync », la technique la plus demandée) ; flou de mouvement à l'export (sous-images mélangées) ;
    grain/vignette en option de film.

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
- **Fait** : schéma, `defaultCampaign`, `formatsFor`, catalogue `RECIPES` (métadonnées : objectifs, formats, `needs`,
  `needsAny`, `wants`, durée du genre) et `buildProposals` (score puis choix glouton avec pénalités de répétition ;
  variantes quand il y a moins de couples que de cases).

### Tranche A : lecture du site (Rust, pur + testé)
- `modules/site/brand.rs` : `site_brand(url)` -> `{ name, tagline, description, lang, colors: { background,
  primary, accent, ink }, fonts: { heading, body }, logo }`. Sources par priorité : variables CSS courantes
  (`--primary`, `--brand`, `--accent`, `--background`, `--foreground`, résolution des `var()`), couleur dominante
  du logo / favicon SVG, `theme-color` ; meta/og, `h1`. Même garde réseau que le proxy (`public_only`).
- `site_sections(url)` : sections par page avec un **rôle** déduit génériquement (structure + mots-clés multilingues) :
  `hero | features | pricing | stats | how-it-works | testimonials | listing | faq | cta | other`.
- Fixtures de chaque site de référence dans `tests/`.
- **Fait** (`modules/site/brand.rs`) : `site_brand` / `site_sections`, testés sur la fixture oeufsdor et un SaaS sombre
  synthétique. Réseau via `SiteClient` (partagé avec `site_pages`) : un site public ne joint jamais une adresse locale,
  ni par DNS, ni par IP littérale, ni par redirection (même règle que `relay_target`).

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
  Point d'extension `CopyProvider` (gabarits locaux par défaut, rédaction IA plus tard).
- Zooms sur les **repères** du rôle visé (remplace `buildAutoZooms` dans ces montages).
- Catalogue aligné sur les genres de référence. MVP : **Product launch**, **Product demo / walkthrough**,
  **Video ad verticale**. Puis : **Explainer** (problème -> solution, voix off), **Teaser** rythmé, **Integration**,
  **Booth video** (boucle muette), **Use case** (une section `listing` / `stats` mise en scène), Prix + CTA.
  Chaque recette suit la structure de son genre ; la campagne choisit lequel et règle durée, ton et textes.

- **Fait** (`packages/campaign/src/build/`, qui dépend de render-engine, et jamais l'inverse) : chaque recette
  déclare sa `structure` (cartes `hook | name | walkthrough | cta` et séquences de plans par rôles, avec poids,
  vitesse, légendes numérotées ou non) ; un seul moteur `buildEdit(proposal, ctx)` la transforme en `EditState`
  valide (`parseEditState`) à la durée du genre (`targetDuration` : l'indice du brief borné au genre).
  `scenesFrom` place les sections dans la prise (sections d'une page réparties sur son chapitre, en attendant les
  `marks`) ; `pickScenes` complète avec les autres sections quand un rôle manque. Le ton règle transitions,
  animations du texte et durée des cartes ; couleurs normalisées en `#rrggbb` (`toHex`), texte lisible
  (`readableOn`). `layers: null` : le shell place les devices (`initialLayers`) quand il connaît la taille source.
  Reste : zooms sur les vrais repères (journal v4), musique, voix off.

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
1. Éditeur : motion blur, transitions entre clips, crop ; export plus rapide.
2. Android : drag en direct, audio (`AndroidAudioProvider`), « Synchronize Interactions » multi-device.
3. `project.json` versionné, avec migrations.
4. Fichier HTML local, browser chrome (Safari / Chrome Android), status bar custom.
