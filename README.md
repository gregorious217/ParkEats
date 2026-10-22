# ParkEats 🌲🍽️

A shared map of restaurants recommended by California State Parks staff. State Park boundaries are shown in sage green. Staff can:

- pin restaurants within 20 miles of a park;
- vote 👍/👎 and comment;
- follow each other;
- filter the map.

**How it's built:** a static website (plain HTML/JS, no build step) plus a free [Supabase](https://supabase.com) project. Supabase provides the database, sign-in and photo storage. There are no servers to maintain.

```
index.html, css/, js/     the website (deploy this whole folder)
data/parks.geojson        simplified CA State Parks boundaries (map layer)
supabase/schema.sql       database tables, rules and functions (run once)
scripts/load-parks.mjs    one-time load of park boundaries into the database
scripts/fetch-parks.mjs   re-download park boundaries if they change
.github/workflows/        optional keep-alive ping for the free tier
```

---

## One-time setup (about 30 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com and create a **New project**. Use a strong database password, and pick the region **West US**.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**.

### 2. Restrict sign-in to @parks.ca.gov
1. Go to **Authentication → Hooks → Add hook → Before User Created**.
2. Choose **Postgres function**, then select `public.hook_restrict_signup_domain`.
3. Click **Create**.

The database also hides all data from non-parks.ca.gov accounts, so the restriction still holds if the hook is ever turned off.

### 3. Email sign-in codes
Some email security scanners "click" sign-in links before you do, which uses up the link. To avoid this, the app also accepts the 6-digit code from the email. You need to add the code to the email templates:

1. Go to **Authentication → Emails → Templates**.
2. In the **Magic Link** template, add this line: `<p>Or enter this code: <b>{{ .Token }}</b></p>`
3. Add the same line to the **Confirm signup** template.

### 4. Email delivery (important)
Supabase's built-in email server only sends a few emails per hour and is meant for testing. Set up a free email service instead, such as [Resend](https://resend.com):

1. Create an account with the email service.
2. In Supabase, go to **Authentication → Emails → SMTP Settings** and enter that service's SMTP details.

> State email filtering may quarantine these emails. Send yourself a test first. If it doesn't arrive, ask IT to allowlist the sender address.

### 5. Site URL
1. Go to **Authentication → URL Configuration**.
2. Set **Site URL** to your hosted address, e.g. `https://parkeats.netlify.app`.
3. Add these **Redirect URLs**:
   - your hosted address;
   - `http://localhost:8765` (for local testing).

### 6. Load park boundaries into the database
The database uses the park boundaries to tag the nearest park and enforce the 20-mile rule.

1. Find the keys in **Project Settings → API Keys**. You need the **Project URL** and a **secret** key (older projects call it `service_role`).
2. Run the loader. It needs Node 18+ and no `npm install`.

   PowerShell:
   ```powershell
   $env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
   $env:SUPABASE_SECRET_KEY="sb_secret_..."
   node scripts/load-parks.mjs
   ```
   You should see `Loaded 458 / 458 parks`.

> Never put the secret key in the website or in Git.

### 7. Configure the website
Edit `js/config.js` and set:
- `SUPABASE_URL`;
- `SUPABASE_ANON_KEY`, using the **publishable** (or legacy `anon`) key.

This key is meant to be public, because the database rules protect the data.

### 8. Test locally
```powershell
npx http-server -p 8765 -c-1 .
```
Open http://localhost:8765 and sign in with your @parks.ca.gov email.

### 9. Make yourself an admin
After your first sign-in, run this in the **SQL Editor**:
```sql
update public.profiles set is_admin = true where email = 'first.last@parks.ca.gov';
```
Reload the page. **Admin** now appears in your name menu. From there you can:
- review reported content;
- delete any post;
- manage food types.

### 10. Deploy
Pick one:
- **Netlify:** drag the project folder onto https://app.netlify.com/drop.
- **Cloudflare Pages:** connect a Git repo and deploy. There is no build command; the output directory is `/`.

Afterwards, set the final URL as the Site URL from step 5.

### 11. Keep the free tier awake
Free Supabase projects pause after 7 days with no activity. To prevent this:
1. Put the project in a GitHub repo.
2. Add the repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

The included workflow pings the database twice a week. The alternative is Supabase Pro at $25/month, which never pauses and adds daily backups.

---

## How it works

| Feature | Where |
|---|---|
| Sign-in (emailed code or link, @parks.ca.gov only) | `js/auth.js`, `hook_restrict_signup_domain`, `is_staff()` |
| Map, parks layer, pins, hover preview | `js/map.js`, `js/card.js` (`previewHtml`) |
| Add / edit (place search, click and drag pin, photo) | `js/restaurants.js` |
| Within 20 miles + nearest park auto-tag | `restaurants_before_write` trigger, `nearest_park()` |
| Duplicate warning (similar name within 100 m) | `find_nearby_duplicates()` |
| 👍/👎, comments, report | `js/card.js`, tables `votes`, `comments`, `flags` |
| Follow people, profiles | `js/social.js`, table `follows` |
| Filters | `js/filters.js` |
| Admin | `js/admin.js` |

**Rules the database enforces:**
- You can only edit or delete your own pins and comments; admins can do either for any.
- One vote per person per restaurant, and you can't vote on your own pin.
- You can't make yourself an admin.

**Photos** are resized in the browser to 1600 px before upload. They are stored in a private bucket that only signed-in staff can view.

**Third-party services (all free, no keys):**
- Esri basemaps;
- [Photon](https://photon.komoot.io) place search (OpenStreetMap data);
- CA State Parks ParkBoundaries feature service.
