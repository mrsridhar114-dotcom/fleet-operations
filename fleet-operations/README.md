# Fleet Operations

Vehicles, drivers, conductors, route bus and truck trip sheets, and the spare bus booking planner, as a website you run yourself.

- **Website and server:** [Vercel](https://vercel.com)
- **Database:** [Neon](https://neon.tech) (Postgres)
- **Code:** [GitHub](https://github.com) (Vercel redeploys every time the code on GitHub changes)

## What's in this folder

| Path | What it is |
|---|---|
| `app/fleet-operations.html` | The app itself, exactly as built on claude.ai |
| `public/claude-shim.js` | Sign-in screen, and connects the app to this site's database and file storage |
| `public/manifest.webmanifest`, `public/icon-*.png` | Lets phones install it like an app ("Add to Home screen") |
| `api/auth.js` | Sign up, sign in, sign out, change and reset passwords |
| `api/db.js` | Reads and saves all records |
| `api/blob.js` | Attached photos and PDFs |
| `lib/` | Shared server code (database connection, logins) |
| `scripts/build.mjs` | Builds `public/index.html` from `app/fleet-operations.html` on every deploy |
| `schema.sql` | The database tables (created automatically; this is for reference) |
| `vercel.json` | Vercel settings (Singapore region, file links, security headers) |
| `.env.example` | The settings you enter in Vercel |

---

## Step 1 · Create the three accounts

### GitHub (stores the code)
1. Go to **https://github.com/signup**.
2. Enter your email, a password and a username, then verify your email with the code GitHub sends.
3. Choose the **Free** plan.

### Vercel (runs the website)
1. Go to **https://vercel.com/signup**.
2. Choose **Hobby** if this is personal use, or **Pro** for a business. Vercel's Hobby plan is for personal, non-commercial projects, so a company's fleet app should be on Pro.
3. Click **Continue with GitHub** and allow Vercel to access your GitHub account. This links the two, so you don't need a separate password.

### Neon (the database)
1. Go to **https://neon.tech** and click **Sign up**.
2. Choose **Continue with GitHub**, the same as Vercel.
3. The **Free** plan is enough to start. Check Neon's pricing page for the current storage and usage limits.

---

## Step 2 · Put the code on GitHub

1. On GitHub, click **+** (top right) → **New repository**.
2. Name: `fleet-operations`. Choose **Private**. Leave the other options alone. Click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Unzip `fleet-operations.zip` on your computer. Open the `fleet-operations` folder, select **everything inside it** (`api`, `app`, `lib`, `public`, `scripts`, `package.json`, `vercel.json` and the rest), and drag it all onto the GitHub page.
5. Wait until every file is listed, then click **Commit changes**.

> If you use **GitHub Desktop** or `git` instead: create the repository, copy the folder contents into it, then commit and push.

---

## Step 3 · Create the database on Neon

1. In Neon, click **New project**.
2. **Project name:** `fleet-operations`. **Postgres version:** the default. **Region:** **AWS Asia Pacific (Singapore)**, which is close to India and matches the Vercel region in `vercel.json`.
3. Click **Create project**.
4. On the project dashboard, click **Connect**. Make sure **Connection pooling** is switched **on**, then copy the connection string. It looks like:
   `postgresql://neondb_owner:xxxx@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
5. Keep it somewhere safe for the next step. **It is a password: don't share it or put it in GitHub.**

You don't need to create any tables. The app creates them the first time it runs.

> **Shortcut:** instead of steps 1–4, you can create the database from inside Vercel: **Project → Storage → Create Database → Neon**. Vercel then adds `DATABASE_URL` for you.

---

## Step 4 · Deploy on Vercel

1. In Vercel, click **Add New… → Project**.
2. Find `fleet-operations` in the list of GitHub repositories and click **Import**.
   If it isn't listed, click **Adjust GitHub App Permissions** and give Vercel access to that repository.
3. **Framework Preset:** **Other**. Leave **Root Directory**, **Build Command** and **Output Directory** as they are; `vercel.json` sets them.
4. Open **Environment Variables** and add these four:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 3 |
   | `SESSION_SECRET` | a long random string. Get one at https://generate-secret.vercel.app/32 |
   | `OWNER_EMAILS` | your email address. This login is always the full Admin. Separate several with commas |
   | `ALLOW_SIGNUP` | `true` (set it to `false` later to stop new people creating logins) |

5. Click **Deploy**. After a minute or so you get a link such as `https://fleet-operations-xxxx.vercel.app`.

---

## Step 5 · First sign-in and moving your data across

1. Open the link and click **New here? Create an account**. Use the **same email you put in `OWNER_EMAILS`** and choose a password. You're in as **Owner · Admin**.
2. **Bring your records over from claude.ai:**
   1. In the claude.ai version, go to **Administration › Storage & backup → Full backup (JSON)** and save the file.
   2. In the new site, go to the same page and click **Restore backup (JSON)**. Only the owner sees this button.
   3. Choose the file. Every vehicle, driver, conductor, user, trip sheet, booking and history entry is loaded.

   **Attached photos and PDFs don't move across.** They stay in the claude.ai app, so attach the ones you need again.
3. **Users:** each person opens the link, creates a login with their own email, and taps **Request access**.
   You then open **User master**: the request is at the top. Click **Create user**, pick their role (Booking planner, Trip update, Fleet manager, and so on) and set them to **Active**.
   - Users restored from the backup were linked to claude.ai accounts. Edit each one and pick their new login under **Linked login**.
4. **Forgotten passwords:** an Admin clicks **Reset a password** under their name in the side menu and gives the person a temporary password. They can change it with **Change password**.

---

## Step 6 · Android app

**Quick way (no store):** open the site in **Chrome** on the phone → sign in → **⋮ → Install app** (or **Add to Home screen**). It gets its own icon and opens full screen.

**Real Android app (APK / Play Store) with PWABuilder:**
1. Go to **https://www.pwabuilder.com**, paste your site link (e.g. `https://fleet-operations-xxxx.vercel.app`) and click **Start**.
2. Click **Package for stores → Android → Generate package**. Keep the package ID it suggests (e.g. `app.vercel.fleet_operations_xxxx.twa`) or set your own, such as `in.yourcompany.fleetops`.
3. Download the zip. Inside are the app (`.apk` for direct install, `.aab` for the Play Store), a **signing key** and **assetlinks.json**. **Keep the signing key safe**; every future update must be signed with it.
4. In this repository create the folder `public/.well-known/` (GitHub: Add file → Create new file, name `public/.well-known/assetlinks.json`, paste the file's contents) and commit. Vercel redeploys; the app then opens without a browser address bar.
5. **Direct install:** send the `.apk` to the phones (WhatsApp/Drive), tap it, allow **Install unknown apps** for that app when asked, and install.
6. **Play Store:** create a Google Play developer account at https://play.google.com/console (one-time fee), **Create app**, upload the `.aab` under **Testing → Internal testing** (or Production), fill in the store listing, content rating and privacy policy, and submit for review.

The app shows the website, so every update you push to GitHub reaches the phones straight away; a new APK is only needed if the name, icon or link changes.

---

## Updating the app later

1. Replace `app/fleet-operations.html` on GitHub with the new version.
   In the repository, open the file, click the **⋯** menu → **Delete file** and commit, then **Add file → Upload files** with the new one. Alternatively, open it, click the pencil, paste the new contents, then **Commit changes**.
2. Vercel sees the change and redeploys by itself in about a minute. Records in the database are not touched.

## Custom web address (optional)

In Vercel: **Project → Settings → Domains → Add**, enter for example `fleet.yourcompany.in`, and add the DNS record Vercel shows at your domain provider.

---

## Good to know

- **Who can see what:**
  - **Before approval:** a login that isn't an Active user in User master can only send an access request. It can't read or change any records or files; the server checks this.
  - **Owners:** the emails in `OWNER_EMAILS` always have full access.
  - **Module rights:** the role settings (which modules each person can open and edit) are applied by the app's screens. An approved user who knows how to call the server directly could still change records their role doesn't show them, so only approve people you trust.
- **Live updates:** each open copy of the app checks for changes every 4 seconds, and every 20 seconds while it's in the background.
- **Files:** each file can be up to **4 MB**, the most a Vercel function accepts. Files are stored in the database. The total space is set by `MAX_FILE_STORAGE_MB` (400 MB by default), within Neon's storage limit. Ask staff to send photos through WhatsApp first, or to scan as PDF, to keep them small.
- **Backups:** Neon keeps a restore history; the free plan has a short window. Still use **Storage & backup → Full backup (JSON)** once a month and keep the file safe.
- **Costs:** all three services have free plans that are enough to start. If you outgrow them, Vercel Pro and Neon Launch are the next steps; check their pricing pages.
