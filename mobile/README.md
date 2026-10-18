# DSC Interior phone app (Android + iPhone)

One project, two apps. It is a native shell around the live DSC website: every screen, rule and report is the website, so a fix on the website reaches every phone at once. Nothing is rebuilt per phone type.

> The app needs the website to be **live on the internet first** (see `docs/GO_LIVE.md`). A phone cannot open a website that only exists on your PC.

## Android – no Android Studio needed
1. Put the website live (Vercel) and note its address, e.g. `https://dsc-erp.vercel.app`.
2. On GitHub open **Actions → Build Android app (APK) → Run workflow**, paste the address.
3. When it finishes (about 5 minutes) download **dsc-interior-android** from *Artifacts*, unzip, and send `app-debug.apk` to the phones. Tapping it installs the app (the phone asks to allow installs from this source once).
4. For the **Google Play Store** later: create a Play Console account ($25 once), make a signing key, build a signed *release* bundle (`./gradlew bundleRelease`) and upload it. This needs a short session together – ask.

Building on your own PC instead: install Android Studio, then in this folder `set CAP_SERVER_URL=https://your-site && npx cap sync android && npx cap open android`.

## iPhone – no Mac needed to build, an Apple account to publish
- **Check it compiles:** Actions → **Check iPhone app builds** → Run workflow. This runs on a cloud Mac.
- **Publish / test on real iPhones:** needs an **Apple Developer account ($99 a year)**, an app record in App Store Connect, and signing certificates. The cloud Mac (GitHub Actions or Codemagic) can build and upload to **TestFlight** once those secrets are added. Apple reviews apps that are only a website in a frame strictly – the app adds native pieces (splash screen, status bar) and the site works as an app, but expect to explain the use (staff app for DSC) in the review notes and give the reviewers a test login.
- Until then iPhone users can use the website: Safari → Share → **Add to Home Screen**.

## Changing the address or the look
- Address: set `CAP_SERVER_URL` and run `npx cap sync`.
- Name / id: `capacitor.config.ts` (`appName`, `appId`).
- Icons: generated from the DSC icon; replace the files under `android/app/src/main/res/mipmap-*` and `ios/App/App/Assets.xcassets/AppIcon.appiconset`.

## Not included yet
- Saving reports on the phone while offline, push notifications and background location are planned native additions; today the app needs signal when you press Send.
