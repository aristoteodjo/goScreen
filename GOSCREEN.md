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
| Recording State | `modules/recording/store.ts` | actif, startedAt, journal d'interactions |

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

Les iframes cross-origin ne se dessinent pas dans un `<canvas>`, donc la capture est native :
`recording_start(region)` convertit le rectangle du stage (CSS px) en pixels physiques écran et lance FFmpeg
via un `ScreenCaptureProvider` propre à chaque OS (avfoundation + crop sur macOS, gdigrab sur Windows, x11grab sur Linux).
Le curseur n'est **pas** gravé dans la vidéo. Les interactions sont écrites à côté du MP4 (`*.interactions.json`)
pour garder touch, zoom et curseur éditables après la capture.

- Sortie : `~/Movies/goScreen/` (vidéos), `~/Pictures/goScreen/` (captures).
- macOS : la fenêtre doit être sur l'écran principal ; l'app (ou le terminal en dev) doit avoir la permission
  « Enregistrement de l'écran ».
- FFmpeg est cherché dans le PATH puis dans `/opt/homebrew/bin` et `/usr/local/bin` (une app GUI macOS a un PATH minimal).

## Vérifications

- Frontend : `pnpm -r check-types`, `pnpm -r test`, `pnpm lint`
- Rust : `cd apps/desktop/src-tauri && cargo test` (via `portly temp`)
- Web : `pnpm --filter @goscreen/web auth:migrate` après un changement de schéma better-auth

## Prochaines tranches verticales

1. Éditeur post-recording : lecture du MP4 et du journal d'interactions, touch rings, zoom caméra, sound effects, export MP4 via FFmpeg.
2. `project.json` versionné, avec migrations.
3. Connexion desktop -> web (jeton dans le keychain, entitlements vérifiés côté serveur).
4. Fichier HTML local, browser chrome (Safari / Chrome Android), status bar custom.
