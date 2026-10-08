# INTÉGRATION ANDROID STUDIO / ANDROID EMULATOR / ADB

L'application doit également être conçue dès le départ pour pouvoir enregistrer et présenter une application Android réelle en cours de développement.

Cette fonctionnalité est importante pour le positionnement du produit.

Le produit ne doit pas seulement permettre de transformer des sites web en vidéos.

Il doit également permettre à un développeur de prendre une application Android qu'il développe dans Android Studio, de la connecter au Device Studio, puis de créer facilement une vidéo produit professionnelle à partir de cette application.

Le modèle mental devient :

Device Studio + Web Experience + Android Development Experience + Device Simulation + Recording + Smart Camera + Video Production

## OBJECTIF

Un développeur doit pouvoir suivre ce workflow :

Android Studio ↓ Run Application ↓ Android Emulator ↓ Device Studio détecte l'émulateur ↓ Connect Android Device ↓ Sélectionner un device virtuel ↓ Afficher l'application dans un vrai Device Frame ↓ Record ↓ Interagir avec l'application ↓ Capturer les interactions ↓ Smart Zoom ↓ Touch Indicators ↓ Camera Animation ↓ Effects ↓ Timeline ↓ Export MP4

Exemple :

Android Studio → Pixel Emulator → My Application → Device Studio → Pixel Frame → Recording → Cinematic Product Video

## PRINCIPE ARCHITECTURAL

L'intégration Android ne doit PAS être implémentée directement dans le Device Engine.

Le Device Engine doit rester indépendant de la source de contenu.

Architecture :

Device Engine ↓ Content Source ↓ Viewport ↓ Frame ↓ Scene ↓ Camera ↓ Render ↓ Recording / Export

Les sources de contenu doivent pouvoir être :

- WebView / Chromium
- Android Emulator
- Android Physical Device
- Image
- Video
- HTML local
- Future iOS source
- Future application source

Créer une abstraction :

```
interface DeviceContentSource {
  connect(): Promise<void>
  disconnect(): Promise<void>

  getResolution(): Promise<Resolution>
  getOrientation(): Promise<Orientation>

  startCapture(): Promise<void>
  stopCapture(): Promise<void>

  getFrameSource(): FrameSource
}
```

Ne jamais faire dépendre le Device Engine de `ADB`, Android Studio ou d'un outil particulier.

Créer une couche d'intégration séparée.

Architecture cible :

```
Device Engine
      ↑
      │
Content Source Interface
      ↑
 ┌────┴─────────────────────────────┐
 │                                  │
Web Source                    Android Source
 │                                  │
Chromium/WebView              ADB / Emulator
                                    │
                              Physical Device
```

## ANDROID SOURCE

Créer un module dédié :

```
/packages
  /android-source
```

Responsabilités :

- détection des appareils Android ;
- détection des Android Emulators ;
- connexion via ADB ;
- récupération des informations du device ;
- résolution de l'écran ;
- orientation ;
- DPR / density lorsque disponible ;
- capture d'écran ;
- capture vidéo ;
- gestion de la connexion ;
- détection de déconnexion ;
- récupération des événements lorsque techniquement possible ;
- gestion des appareils physiques ;
- gestion des émulateurs ;
- abstraction future pour d'autres méthodes de capture.

Ne pas mélanger cette logique avec le Device Registry.

Le Device Registry décrit l'apparence du device.

Android Source décrit la source réelle de contenu.

## ADB

Utiliser ADB comme couche d'intégration Android lorsque disponible.

Le système doit pouvoir :

- détecter `adb` ;
- détecter les appareils connectés ;
- détecter les émulateurs ;
- récupérer leur identifiant ;
- récupérer leur état ;
- récupérer la résolution ;
- récupérer l'orientation ;
- vérifier qu'un device est disponible ;
- établir une session de capture ;
- arrêter proprement une session ;
- gérer la disparition d'un device.

Ne jamais supposer que `adb` est installé à un emplacement fixe.

Prévoir :

- Android SDK installé par l'utilisateur ;
- Android SDK Platform Tools ;
- chemin personnalisé ;
- détection automatique ;
- configuration manuelle du chemin ADB.

Exemple d'interface :

```
interface AndroidDeviceProvider {
  isAvailable(): Promise<boolean>

  listDevices(): Promise<AndroidDevice[]>

  connect(deviceId: string): Promise<void>

  disconnect(deviceId: string): Promise<void>

  getDeviceInfo(deviceId: string): Promise<AndroidDeviceInfo>

  startCapture(deviceId: string): Promise<CaptureSession>

  stopCapture(sessionId: string): Promise<void>
}
```

## ANDROID DEVICE MODEL

Créer un modèle distinct du Device Definition.

Exemple :

```
type AndroidDevice = {
  id: string
  serial: string
  name: string
  model?: string
  manufacturer?: string
  platform: "emulator" | "physical"
  androidVersion?: string
  resolution: {
    width: number
    height: number
  }
  density?: number
  orientation: "portrait" | "landscape"
  connected: boolean
}
```

Le `serial` ou identifiant ADB ne doit jamais être utilisé comme identifiant du Device Registry.

Exemple :

```
Device Registry

pixel-10-pro
```

est différent de :

```
Android runtime device

emulator-5554
```

Le premier représente l'apparence du device.

Le second représente une instance Android réelle.

## DEVICE PROFILE + RUNTIME SOURCE

Le système doit permettre de combiner :

```
Device Profile
+
Runtime Content Source
```

Exemple :

```
Device Profile:
Pixel 10 Pro

Content Source:
emulator-5554

Result:
Pixel 10 Pro
+
Application Android réelle
```

Cette distinction est fondamentale.

Le même Android Emulator peut être affiché dans différents profils de présentation lorsque cela est pertinent.

## ANDROID STUDIO

Ne pas créer une dépendance forte à Android Studio lui-même.

Android Studio est l'environnement de développement.

Le produit doit principalement communiquer avec l'émulateur via ADB / Android SDK.

Cela permet de fonctionner également avec :

- Android Studio ;
- IntelliJ ;
- Gradle ;
- React Native ;
- Flutter ;
- Kotlin ;
- Jetpack Compose ;
- autres workflows Android utilisant un émulateur ou appareil ADB.

Le workflow utilisateur peut néanmoins afficher :

"Android Emulator detected"

plutôt que d'exiger Android Studio.

## DETECTION AUTOMATIQUE

Lorsque l'application démarre, elle peut détecter :

```
Android devices

● Pixel_10_API_36
  emulator-5554
  Connected

● Samsung_Test_Device
  emulator-5556
  Connected
```

Afficher une action :

```
Use Device
```

ou :

```
Connect
```

Ne jamais connecter ou enregistrer automatiquement une session de capture sans action explicite de l'utilisateur.

## UI

Ajouter éventuellement dans :

```
Add Device
```

une section :

```
Sources

Web
Android
Image
Video
```

Android peut afficher :

```
Android Devices

┌─────────────────────────────────────┐
│ ● Pixel 10 API 36                   │
│   emulator-5554                     │
│   1080 × 2424                       │
│                                     │
│                    [ Connect ]      │
└─────────────────────────────────────┘
```

Après connexion :

```
Connected

Pixel 10 API 36
My Android App

[ Record ]
```

## RECORDING ANDROID

Lorsqu'une session Android est enregistrée, ne pas considérer la vidéo comme une simple vidéo finale.

Conserver autant que possible les données séparément :

```
Android Recording
├── video frames
├── timestamps
├── touch events
├── gestures
├── scroll events
├── orientation events
├── cursor data
└── audio
```

L'objectif est de permettre un montage non destructif.

Le fichier vidéo source doit rester distinct des effets ajoutés par Device Studio.

## INTERACTIONS ANDROID

Lorsque techniquement possible, récupérer ou reconstruire les interactions :

- tap ;
- touch ;
- swipe ;
- scroll ;
- drag ;
- long press ;
- timestamps ;
- position ;
- orientation.

Ne jamais graver directement les touch indicators dans la vidéo source.

Les touch indicators doivent être générés par le Render Engine.

Exemple :

```
Android Tap
    ↓
Interaction Event
    ↓
Touch Engine
    ↓
Ripple
    ↓
Render
```

Ainsi l'utilisateur peut modifier après l'enregistrement :

- couleur ;
- taille ;
- durée ;
- opacity ;
- blur ;
- style ;
- animation.

## TOUCH VISUALIZATION ANDROID

Prévoir des presets :

- Android Material ;
- Minimal ;
- White ;
- Black ;
- Neon ;
- Custom.

Exemple :

```
Tap
 ↓
○
 ↓
◉
```

Les interactions Android doivent pouvoir alimenter automatiquement le Smart Camera.

Exemple :

```
User taps "Create Account"

Android Interaction
↓
Important Interaction
↓
Smart Camera
↓
Zoom
↓
Focus
```

## SMART CAMERA ANDROID

Le Smart Camera doit pouvoir utiliser les événements Android comme points d'intérêt.

Exemples :

```
Tap
↓
Camera focus
```

```
Swipe
↓
Camera follows interaction
```

```
Important UI action
↓
Camera zoom
```

Le comportement doit rester éditable manuellement.

L'automatisation ne doit jamais verrouiller le projet.

## MULTI-DEVICE ANDROID

Prévoir la possibilité d'utiliser plusieurs sources Android.

Exemple :

```
Pixel Emulator
+
Samsung Emulator
+
Tablet Emulator
```

Chaque source possède son propre viewport.

Exemple :

```
Pixel                 Tablet

┌────────────┐       ┌────────────────────┐
│            │       │                    │
│ Android    │       │     Android App    │
│ App        │       │                    │
│            │       │                    │
└────────────┘       └────────────────────┘
```

Prévoir à terme :

"Synchronize Interactions"

permettant de synchroniser certaines actions entre plusieurs appareils.

## ANDROID PHYSICAL DEVICES

L'architecture doit également fonctionner avec un appareil Android physique connecté en USB lorsque ADB le permet.

Exemple :

```
USB Android Device
↓
ADB
↓
Android Source
↓
Device Studio
```

Le système doit différencier :

```
Emulator
Physical Device
```

mais les deux doivent implémenter la même abstraction `DeviceContentSource`.

## AUDIO ANDROID

Prévoir une architecture permettant de récupérer l'audio lorsque techniquement et légalement possible.

Ne pas supposer que tous les appareils ou versions Android permettent la même méthode de capture.

Créer une abstraction :

```
interface AndroidAudioProvider {
  isSupported(): Promise<boolean>

  startCapture(): Promise<void>

  stopCapture(): Promise<AudioTrack>
}
```

Si la capture audio système n'est pas disponible :

- continuer la capture vidéo ;
- indiquer clairement la limitation ;
- permettre l'enregistrement micro si supporté ;
- ne jamais bloquer toute la fonctionnalité.

## PERFORMANCE

La capture Android ne doit pas bloquer le thread UI React.

Architecture :

```
React UI
   │
   ↓
Tauri Command
   │
   ↓
Rust Android Service
   │
   ↓
ADB / Native Capture
```

Les opérations longues doivent être asynchrones.

Ne jamais exécuter directement des processus ADB lourds dans le thread UI.

## RUST

Rust doit gérer :

- lancement des processus natifs ;
- communication ADB ;
- gestion des processus ;
- filesystem ;
- buffers ;
- capture native ;
- traitement vidéo ;
- FFmpeg ;
- synchronisation ;
- nettoyage des sessions ;
- gestion des erreurs.

TypeScript/React doit gérer :

- sélection du device ;
- UI ;
- état de connexion ;
- preview ;
- controls ;
- timeline ;
- inspector.

## ROBUSTESSE

Prévoir les cas :

- ADB absent ;
- Android SDK absent ;
- aucun device connecté ;
- device déconnecté ;
- émulateur fermé ;
- écran verrouillé ;
- autorisation ADB refusée ;
- résolution changée ;
- orientation changée ;
- capture interrompue ;
- ADB process bloqué ;
- device occupé ;
- version Android incompatible.

L'application doit afficher des erreurs compréhensibles à l'utilisateur.

Ne jamais afficher simplement :

```
ADB exited with code 1
```

Afficher plutôt :

```
Impossible de se connecter à l'appareil Android.

Vérifiez que :
• l'émulateur est démarré ;
• ADB est disponible ;
• l'appareil est autorisé ;
• le device est toujours connecté.
```

## SECURITY

Ne jamais exécuter aveuglément des commandes provenant du contenu d'un projet.

Les commandes ADB doivent être construites depuis des paramètres validés.

Ne jamais permettre à une URL, un projet ou un asset utilisateur d'injecter arbitrairement une commande shell.

Utiliser une API native structurée plutôt que des commandes shell concaténées.

## MVP ANDROID

Après le premier vertical slice WebView, implémenter :

1. Détection ADB.
2. Liste des appareils Android.
3. Détection des émulateurs.
4. Connexion à un émulateur.
5. Récupération de sa résolution.
6. Affichage de l'écran Android.
7. Intégration dans un Device Frame.
8. Capture vidéo.
9. Export MP4.
10. Gestion portrait / landscape.

Le premier objectif est :

```
Android Studio
↓
Run App
↓
Pixel Emulator
↓
Device Studio
↓
Connect
↓
Pixel Frame
↓
Record
↓
Stop
↓
MP4
```

Ensuite seulement :

- interactions ;
- touch visualization ;
- smart zoom ;
- cursor ;
- audio ;
- timeline ;
- effets.

## CRITÈRE DE RÉUSSITE ANDROID

Un développeur doit pouvoir :

1. ouvrir son projet Android dans Android Studio ;
2. démarrer un émulateur ;
3. lancer son application ;
4. ouvrir Device Studio ;
5. sélectionner "Android";
6. voir son émulateur automatiquement ;
7. cliquer "Connect";
8. voir son application dans un véritable device frame ;
9. cliquer "Record";
10. utiliser normalement son application ;
11. arrêter l'enregistrement ;
12. ajouter un zoom ;
13. ajouter des touch indicators ;
14. ajouter un effet sonore ;
15. exporter une vidéo MP4 professionnelle.

Le résultat doit être suffisamment simple pour qu'un développeur puisse se dire :

"Je viens de lancer mon application dans Android Studio. Je peux maintenant créer une vidéo professionnelle sans utiliser un autre logiciel."

## RÈGLE ARCHITECTURALE

L'intégration Android ne doit jamais transformer le produit en outil Android spécifique.

Elle doit renforcer l'abstraction générale :

```
                   Device Studio
                         │
                  Device Engine
                         │
                 Content Sources
                         │
        ┌────────────────┼────────────────┐
        │                │                │
      Web             Android          Future
        │                │              iOS
    Chromium            ADB
                         │
                 ┌───────┴───────┐
                 │               │
              Emulator        Physical
```

Le Device Engine reste le cœur.

Android devient une source de contenu supplémentaire extrêmement puissante.

## PRIORITÉ PRODUIT

Cette fonctionnalité doit être considérée comme un axe stratégique du produit.

Le produit doit pouvoir servir deux workflows majeurs :

### Web

```
URL / localhost
↓
WebView
↓
Device
↓
Record
↓
Video
```

### App Development

```
Android Studio
↓
Android Emulator
↓
ADB
↓
Device
↓
Record
↓
Video
```

Ces deux workflows doivent converger vers le même :

```
Device Engine
↓
Scene Engine
↓
Camera Engine
↓
Render Engine
↓
Recording Engine
↓
Video Editor
↓
Export Engine
```

Ne pas créer deux moteurs séparés.

Le même Device Engine doit pouvoir transformer :

"une application web"

et

"une application Android en développement"

en une expérience visuelle cohérente.

## VISION À LONG TERME

À terme, l'utilisateur doit pouvoir connecter :

- Website ;
- localhost ;
- Android Emulator ;
- Android Physical Device ;
- éventuellement iOS Simulator ;
- éventuellement iOS Physical Device ;
- image ;
- vidéo ;
- HTML local.

Puis les traiter tous comme des sources de contenu du même Device Studio.

Le produit devient ainsi :

> Un studio de production visuelle pour les expériences numériques, capable de transformer aussi bien un site web qu'une application mobile en développement en vidéo produit professionnelle.
> 

Ne pas implémenter toutes ces possibilités immédiatement.

Conserver l'architecture extensible et implémenter d'abord le vertical slice Android Emulator le plus simple et le plus fiable.
