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
4. L'iframe est sandboxée **sans** `allow-top-navigation` : une page prévisualisée ne peut pas naviguer la fenêtre du studio.

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
- Démarrage : FFmpeg ne crée la sortie qu'à la première frame. Sans fichier après 6 s, c'est la permission
  « Enregistrement de l'écran » qui manque : erreur explicite qui nomme l'app responsable (premier `.app`
  parmi les ancêtres du process, `recording/permissions.rs`) avec un bouton vers le bon panneau des Réglages.
  En dev, c'est **Portly.app**. Arrêt : `q`, puis SIGINT, puis kill. Les PID sont notés dans le cache : un FFmpeg orphelin
  (crash, rebuild) est tué au lancement suivant.

### Site tour

- « Site tour » (barre de capture) enregistre un site entier en une prise. Rust (`modules/site/`) trouve les
  pages : `sitemap.xml`, sinon les liens internes de l'accueil et des pages liées (même origine, sans assets).
- `tour/runTour.ts` : bascule de vue et chargement de la 1re page **avant** de lancer la caméra, puis pour
  chaque page : ouverture sur tous les devices web synchronisés (attente des `location` de type `load`),
  pause, scroll doux de haut en bas (`scrollTo` via le bridge), pause. Stop dans la toolbar arrête le tour.
  Timings purs et testés dans `tour/plan.ts`.

### Capture native

Les iframes cross-origin ne se dessinent pas dans un `<canvas>`, donc la capture est native :
`recording_start(region)` convertit le rectangle du stage (CSS px) en pixels physiques écran et lance FFmpeg
via un `ScreenCaptureProvider` propre à chaque OS (avfoundation + crop sur macOS, gdigrab sur Windows, x11grab sur Linux).
Le curseur n'est **pas** gravé dans la vidéo. Les interactions sont écrites à côté du MP4 (`*.interactions.json`)
pour garder touch, zoom et curseur éditables après la capture.

- Sortie : `~/Movies/goScreen/` (vidéos), `~/Pictures/goScreen/` (captures).
- macOS : la fenêtre doit être sur l'écran principal ; l'app (ou le terminal en dev) doit avoir la permission
  « Enregistrement de l'écran ».
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
- Export : seek frame par frame -> JPEG -> `export_frame` (corps IPC brut) -> FFmpeg ; second passage pour
  mixer les sons de tap synthétisés. Sortie `~/Movies/goScreen/<nom>-export-<stamp>.mp4`.
- `buildAutoZooms` (render-engine) propose des zooms à la première ouverture ; tout reste éditable.

## Vérifications

- Frontend : `pnpm -r check-types`, `pnpm -r test`, `pnpm lint`
- Rust : `cd apps/desktop/src-tauri && cargo test` (via `portly temp`)
- Web : `pnpm --filter @goscreen/web auth:migrate` après un changement de schéma better-auth

## Prochaines tranches verticales

1. Éditeur : curseur pour les sources web, motion blur, presets, crop, caméra (webcam) ; export plus rapide.
2. Android : drag en direct, audio (`AndroidAudioProvider`), « Synchronize Interactions » multi-device.
3. `project.json` versionné, avec migrations.
4. Connexion desktop -> web (jeton dans le keychain, entitlements vérifiés côté serveur).
5. Fichier HTML local, browser chrome (Safari / Chrome Android), status bar custom.
