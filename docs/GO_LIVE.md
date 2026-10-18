# Going live – step by step

Everything below can be done by one person in about an hour. You need three free accounts: **GitHub** (already done), **Neon** (database) and **Vercel** (the website). A fourth, **Cloudflare R2** (file storage), is needed before staff upload photos and documents.

> Nothing here costs money on the free plans, which are enough to start. Move to paid plans when the company is using it every day.

## 1. The database (Neon) – 5 minutes
1. Go to **neon.tech**, sign up, create a project called `dsc-erp`.
2. Copy the **connection string** (starts with `postgresql://`). Keep it private – it is the key to all company data.

## 2. File storage (Cloudflare R2) – 10 minutes
Vercel has no permanent disk, so photos and documents must live in a bucket.
1. Go to **cloudflare.com → R2**, create a bucket named `dsc-files`. Keep it **private** (do not enable public access).
2. Create an **API token** with *Object Read & Write* on that bucket. Note the *Access Key ID*, *Secret Access Key* and the *S3 endpoint* (`https://<account-id>.r2.cloudflarestorage.com`).

## 3. The website (Vercel) – 10 minutes
1. In Vercel: **Add New → Project →** pick `Dsc_Crm_Erp_Software`. Framework: **Next.js**. Root directory: leave blank.
2. Under **Environment Variables** add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `AUTH_SECRET` | a long random string (run `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `APP_URL` | your Vercel address, e.g. `https://dsc-erp.vercel.app` |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` | `dsc-files` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from Cloudflare |
| `S3_ENDPOINT` | the R2 endpoint |
| `S3_REGION` | `auto` |
| `CRON_SECRET` | any 16+ character secret (lets the 7 AM daily reminders run) |

3. Click **Deploy**. Every deploy automatically creates/updates the database tables (`vercel-build` runs `prisma migrate deploy`).

## 4. Create the company and the first login – 2 minutes
On your own computer, in the `app` folder (use the same `DATABASE_URL` as Vercel):
```
set DATABASE_URL=<the Neon connection string>
npm run setup:company -- --company "DSC Interior Pvt. Ltd." --gstin 27AAECD2813K1ZP --owner-name "Full Name" --owner-email you@yourdomain.com --password "a-long-password"
```
This creates the company and **one Owner login with no demo data**. It refuses to run if the company already exists.
Then open your website, sign in, and:
- **Settings → Company**: address, phone, bank details, logo text, default payment terms.
- **Settings → Team & Users**: add every employee (Sales, Project Managers, Supervisors, Accounts, HR, Store…). Give each a role; they get a first password to change.
- **Settings → Time Limits**: check the report deadlines (10:00, outstation 9:30, evening 19:00) and the leave rules.
- **Settings → Import**: bring in clients, vendors, materials, workers and employees from Excel/CSV (the Keka employee export works as it is).

> **Do not run `npm run db:seed` on the live database.** It loads demo clients and demo logins (password `Demo@1234`).

## 5. Put it on phones
- Open the website on the phone in Chrome (Android) or Safari (iPhone).
- Android: tap **Install app**. iPhone: **Share → Add to Home Screen**.
- It then opens full screen with the DSC icon, like an app.

## 6. Backups and safety
- Neon keeps point-in-time history on paid plans; on the free plan also export regularly: `pg_dump "<connection string>" > dsc-backup.sql`.
- R2: turn on **versioning** if you want protection against accidental deletes.
- Keep `AUTH_SECRET` safe. Changing it signs everyone out and invalidates saved WhatsApp tokens.
- Revoke any access token you ever pasted into a chat or email.

## 7. Still to connect (needs your own accounts)
| What | Where |
|---|---|
| WhatsApp Business messages | Settings → WhatsApp Connection (your Meta credentials) |
| E-mail sending | not wired yet – add a sender in `src/lib/notify.ts` |
| Android / iPhone store apps | see `Dsc_app/README.md` |
