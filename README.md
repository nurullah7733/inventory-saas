# Inventory & Accounting SaaS

A Next.js application for managing inventory, sales, purchases, and accounting.
The application uses PostgreSQL for business data and Vercel Blob or local disk
for uploaded images.

## Database setup

Use a PostgreSQL database hosted on **Neon** or **Prisma Postgres**. Configure a
PostgreSQL connection string compatible with the project's database client.

Copy `.env.example` to `.env` and fill in the database and authentication values:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
APP_DATABASE_URL="postgresql://app_runtime:PASSWORD@HOST/DATABASE?sslmode=require"
JWT_SECRET="YOUR_SECRET_AT_LEAST_32_CHARACTERS_LONG"
```

- `DATABASE_URL`: database owner connection used for schema management.
- `APP_DATABASE_URL`: restricted application connection used at runtime to enforce
  PostgreSQL row-level security for tenant isolation.
- For Neon, use the pooled connection endpoint for the application runtime.

Follow the database setup commands in `.env.example`, including
`npm run db:app-role -- --write-env` to create the runtime role. Configure the same
required database and authentication variables in your Vercel project before deployment.

## Image storage setup

Uploaded image files are stored separately from PostgreSQL. The database stores
the image URL used to display each image. Business logo uploads automatically
save the new URL to the database; no separate Save action is required for the logo.

### Configure Vercel Blob

Create and connect a Blob store from your application's **Vercel project**:

1. Open the project in the Vercel dashboard and go to **Storage**.
2. Create a **Blob** store and select **Public** access. The current image upload
   and display implementation uses public image URLs.
3. Keep the environment variable prefix as **BLOB**.
4. Enable **Add a read-write token env var to this connection**.
5. Create the store and confirm that `BLOB_STORE_ID` and `BLOB_READ_WRITE_TOKEN`
   are available in the project's environment variables for the required
   environments, including Production.
6. Deploy or redeploy the application so it receives the environment variables.

Public image URLs can be viewed by anyone who has the URL. Private Blob stores
require changes to the application's upload and image-serving implementation.

### Use Blob storage during local development

Add the store ID and read-write token to your local `.env`:

```env
BLOB_STORE_ID="YOUR_BLOB_STORE_ID"
BLOB_READ_WRITE_TOKEN="YOUR_BLOB_READ_WRITE_TOKEN"
```

Replace the placeholders with actual values; empty strings do not enable Blob
storage. Restart `npm run dev` after changing `.env`.

With a valid `BLOB_READ_WRITE_TOKEN`, uploads from the local development app go
straight to **Vercel Blob**, and saved image URLs point to Blob storage. The
current storage selection is controlled by `BLOB_READ_WRITE_TOKEN`.

### Local uploads without Blob

When the Blob token is missing or empty and the app is running outside Vercel,
images are saved in the project's **`.uploads/`** directory and served through
`/media/...`.

To use an `./upload` folder instead, explicitly configure:

```env
LOCAL_UPLOAD_DIR="./upload"
```

Local storage is suitable for development or a server with persistent disk.
Existing local images are not automatically migrated when Blob storage is enabled.

### Uploads when hosted on Vercel

On Vercel, uploads use **Vercel Blob when the read-write token is configured**.
Without the token, uploads are unavailable; the app does not fall back to local
disk on Vercel. Hosting on Vercel alone does not configure Blob storage.

| Environment | Blob token | Image destination |
| --- | --- | --- |
| Local development | Configured | Vercel Blob |
| Local development | Missing or empty | `.uploads/`, or `LOCAL_UPLOAD_DIR` |
| Vercel deployment | Configured | Vercel Blob |
| Vercel deployment | Missing or empty | Uploads unavailable |

Keep `.env` and storage tokens private. Never expose the read-write token through
an environment variable prefixed with `NEXT_PUBLIC_`.

## Run locally

Install dependencies, configure `.env`, and prepare the database before starting:

```bash
npm install
npm run dev
```

Open http://localhost:3000, or the port shown in the terminal.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run build
```
