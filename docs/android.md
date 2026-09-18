# Android build

`.github/workflows/build-android.yml` wraps the built web app with Capacitor. It
only runs when started by hand, because the web app is the product.

- **The API address must be absolute.** Capacitor serves the app from
  `https://localhost`, where `/api` leads nowhere. The workflow takes the
  deployed API's URL as an input, bakes it in through `VITE_API_BASE`, then
  searches the bundle to prove it is there. A build without it installs fine
  and shows nothing.
- **CORS.** `https://localhost` and `capacitor://localhost` are the only
  default `allowedOrigins`. The web app is same-origin everywhere, because both
  Vite servers proxy `/api`, so dev ports never needed listing. `strictPort`
  makes a second `npm run dev` fail, instead of quietly starting on another
  port.
- **Location permissions are patched into the generated manifest.** Capacitor's
  template declares only `INTERNET`, `cap add android` regenerates the file on
  every run, and the config has no field for permissions. If they are missing,
  Android refuses location **without showing a dialog**, so it looks as if the
  user said no. The patch adds both `ACCESS_COARSE_LOCATION` and
  `ACCESS_FINE_LOCATION`, because Android 12 ignores a fine-only request. Every
  `uses-feature` gets `required="false"`, so Google Play doesn't hide the app
  from phones with poor GPS. `@capacitor/geolocation` wouldn't help, because its
  manifest is empty.
- **The keystore is a throwaway.** A real release needs a keystore stored as a
  secret. That is deliberately not set up.
- The viewport matches the web app's: nothing is drawn under the system bars
  (see [offline.md](offline.md)).
