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

> **Already ran an older schema** that limited sign-up to @parks.ca.gov? Run `supabase/open-signup.sql` too, and delete the "Before User Created" hook under **Authentication → Hooks** if you added one.

### 2. Sign-in settings (no email service needed)
People sign in with an email and password. ParkEats never sends email.

1. Go to **Authentication → Sign In / Providers → Email**.
2. Turn **Confirm email** **OFF**. This is the step that removes the need for an email service.
3. Make sure **Allow new users to sign up** (under Authentication → Sign In / Providers) is **ON**.
4. Optionally, set **Minimum password length** to `8`.

What this means:
- **Anyone can create an account**, and the email isn't checked. Use **Report** and the admin page to remove anything unwanted.
- **Email addresses are hidden** from other users. People only see display names.
- **Signed-in users** can change their password from **My profile**.
- **Forgotten passwords** are reset by an admin (see "Reset a password" below).

### 3–5. (Not needed)
The email template and SMTP steps are no longer required.

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
Open http://localhost:8765, click **Create an account**, and sign up.

### 9. Make yourself an admin
After your first sign-in, run this in the **SQL Editor**, using the email you signed up with:
```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```
Reload the page. **Admin** now appears in your name menu. From there you can:
- review reported content;
- delete any post;
- manage food types.

### 10. Deploy
Pick one:
- **Netlify:** drag the project folder onto https://app.netlify.com/drop.
- **Cloudflare Pages:** connect a Git repo and deploy. There is no build command; the output directory is `/`.

Optionally, set the final URL as the **Site URL** under Authentication → URL Configuration.

### 11. Keep the free tier awake
Free Supabase projects pause after 7 days with no activity. To prevent this:
1. Put the project in a GitHub repo.
2. Add the repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

The included workflow pings the database twice a week. The alternative is Supabase Pro at $25/month, which never pauses and adds daily backups.

---

## Admin tasks

**Reset a forgotten password.** Run this in the SQL Editor, then give the person the temporary password and ask them to change it under **My profile**:
```sql
update auth.users
set encrypted_password = extensions.crypt('TempPass123!', extensions.gen_salt('bf'))
where email = 'person@example.com';
```

**Remove an account** (deletes their pins, votes and comments too): go to **Authentication → Users**, then **⋯ → Delete user**.

---

## How it works

| Feature | Where |
|---|---|
| Sign-in (email + password, no emails sent) | `js/auth.js`, `is_member()` |
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

**Photos** are resized in the browser to 1600 px before upload. They are stored in a private bucket that only signed-in users can view.

**Third-party services (all free, no keys):**
- Esri basemaps;
- [Photon](https://photon.komoot.io) place search (OpenStreetMap data);
- CA State Parks ParkBoundaries feature service.
