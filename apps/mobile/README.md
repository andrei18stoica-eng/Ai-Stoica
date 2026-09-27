# AI Stoica Mobile — iPhone, iPad și Android

Aplicația mobilă folosește Expo/React Native și același cod pentru iOS și Android.

## Backend permanent

Aplicația trebuie să primească un Gateway HTTPS public prin:

```env
EXPO_PUBLIC_GATEWAY_URL=https://domeniul-tau
EXPO_PUBLIC_DEFAULT_MODEL=Ai principal
```

Gateway-ul rulează pe Oracle Cloud, iar OmniRoute rămâne privat în Docker. Nu configura aplicația mobilă direct către portul 20128.

## Verificare locală

```bash
npm install --legacy-peer-deps
npm run doctor
npm run export:ios
npm run export:android
```

## Build iPhone / iPad

Pentru un build semnat instalabil pe dispozitive Apple este necesar un cont Apple Developer și proiectul trebuie legat la un cont Expo/EAS.

După configurarea Expo:

```bash
eas init
eas build --platform ios --profile preview
```

Pentru App Store/TestFlight:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

Repository-ul include și workflow-ul GitHub Actions **Build AI Stoica Mobile with EAS**. Pentru el trebuie setate în GitHub:

- `EXPO_TOKEN`
- `EXPO_PUBLIC_GATEWAY_URL`

Nu salva tokenuri Apple, Expo sau chei de AI în repository.

## Build Android

```bash
eas build --platform android --profile preview
```

sau profilul `production` pentru distribuția finală.
