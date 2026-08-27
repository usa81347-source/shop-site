# Your shop site — setup guide

Everything here is free on Cloudflare's free tier for a small shop. Five files, all doable from your phone. Follow the steps in order.

## What's in this project

- `index.html` — the public catalog customers see
- `admin.html` — your private admin page (add/edit/delete products)
- `functions/api/_middleware.js` — the backend (login, product data, image upload)
- `schema.sql` — one-time database setup
- `README.md` — this file

## Step 1 — Put the files on GitHub

1. Create a new **public or private repo** on GitHub (e.g. `my-shop`).
2. For each file above, tap **Add file → Create new file**.
3. In the "name your file" box, type the **full path exactly**, including folders — e.g. type `functions/api/_middleware.js` as the filename. GitHub creates the folders automatically. Don't create folders separately.
4. Paste the file's content in below, then **Commit new file**.
5. Repeat for all 5 files.

## Step 2 — Connect Cloudflare Pages

1. Go to the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick your repo. Build settings: leave the build command **empty** and output directory as `/` (this site has no build step).
3. Deploy. It'll go live at `your-project.pages.dev` — but it won't work fully until Steps 3–5 are done.

## Step 3 — Create the database (D1)

1. Dashboard → **Workers & Pages → D1** → **Create database**. Name it anything, e.g. `shop-db`.
2. Open it → **Console** tab.
3. Paste the entire contents of `schema.sql` and run it. This creates your products table.

## Step 4 — Create image storage (R2)

1. Dashboard → **R2** → **Create bucket**. Name it e.g. `product-images`.
2. Open the bucket → **Settings** → find **Public Access** → allow access via the `r2.dev` subdomain.
3. Copy the public URL it gives you (looks like `https://pub-xxxxxxxx.r2.dev`). You'll need it in Step 5.

## Step 5 — Connect everything to your Pages project

Go to your Pages project → **Settings**:

**Functions → D1 database bindings** — Add binding:
- Variable name: `DB`
- Database: the one you made in Step 3

**Functions → R2 bucket bindings** — Add binding:
- Variable name: `PRODUCT_IMAGES`
- Bucket: the one you made in Step 4

**Environment variables** — Add these three:
- `ADMIN_PASSWORD` (type: **Secret**) — the password you'll log in with
- `SESSION_SECRET` (type: **Secret**) — any long random string (mash your keyboard, 20+ characters) — you'll never need to type this yourself
- `R2_PUBLIC_URL` (type: **Plain text**) — the `r2.dev` URL from Step 4, no trailing slash

After saving, go to **Deployments** and **retry/redeploy** the latest deployment so the new bindings and variables take effect.

## Step 6 — Customize and go live

Open `index.html` on GitHub, tap the pencil (edit) icon, and change these three lines near the bottom:

```js
const SHOP_NAME = "My Shop";            // your shop's name
const WHATSAPP_NUMBER = "911234567890"; // your number: country code + number, digits only
const CURRENCY_SYMBOL = "₹";            // ₹, $, €, £, etc.
```

Commit the change — Cloudflare redeploys automatically within a minute.

## Using it day to day

- **Add/edit/delete products:** go to `your-project.pages.dev/admin.html`, log in with `ADMIN_PASSWORD`, and use the form.
- **View your shop:** `your-project.pages.dev` — share this link with customers.
- Every change you make in the admin page is live immediately — no redeploy needed. You only need to touch GitHub again if you change something in the code itself (like the shop name).

## If something's not working

- **"Server error" on the admin page:** almost always a binding name typo. Double-check `DB` and `PRODUCT_IMAGES` match exactly (case-sensitive) in Settings → Functions.
- **Login fails:** check `ADMIN_PASSWORD` is saved correctly, and that you redeployed after adding it.
- **Images don't upload:** check `R2_PUBLIC_URL` has no trailing slash and public access is enabled on the bucket.
- **See live errors:** Pages project → your deployment → **Functions** tab has real-time logs.

Free tier is generous for a small shop (thousands of product views/edits a day before any cost kicks in), so you shouldn't need to worry about limits.
