# CVO Mobile (Expo / React Native)

Expo app consuming the same Laravel API as the web frontend, using **Sanctum bearer tokens** (`POST /api/v1/token-login`) stored in AsyncStorage.

## Setup

```bash
npm install
```

### API URL configuration

Edit `.env` (or export `EXPO_PUBLIC_API_URL`):

| Target            | URL                          |
|-------------------|------------------------------|
| Android emulator  | `http://10.0.2.2:8000` (default) |
| iOS simulator     | `http://localhost:8000`      |
| Physical device   | `http://<your-LAN-IP>:8000`  |

The backend must be reachable from the device — make sure `php artisan serve` is running.

> Physical devices also need the backend host listed in
> `CORS_ALLOWED_ORIGINS`/`SANCTUM_STATEFUL_DOMAINS` is not required for token
> auth; bearer tokens bypass the stateful/CSRF machinery entirely.

## Run

```bash
npm start          # Expo dev server — scan the QR code with Expo Go
npm run android    # Android emulator
npm run ios        # iOS simulator (macOS only)
```

## Demo login (after `php artisan migrate --seed`)

- member@example.com / password

## Structure

```
src/
├── api/            # axios client (token interceptor), endpoint fns, token store
├── config.js       # API_URL resolution
├── context/        # AuthContext (token + user persistence)
└── screens/        # LoginScreen, ProjectsScreen
```
