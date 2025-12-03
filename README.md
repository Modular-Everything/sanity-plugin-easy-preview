## Usage

# sanity-plugin-easy-preview

Easily preview draft changes in a new tab, without all the fussy setup. This plugin adds a "Preview" button to configured document types in Sanity Studio that securely opens your frontend site with draft content enabled.

## Features

- 🔒 **Secure preview access** using `@sanity/preview-url-secret` for cryptographically secure tokens
- ⚡ **Simple configuration** with sensible defaults
- 🎯 **Per-document-type settings** with custom URL prefixes
- 🔧 **Flexible slug field** configuration supporting dot notation
- 🎨 **Native Sanity UI** with toast notifications for errors
- 🧹 **Automatic cleanup** of expired preview secrets

## Installation

```sh
npm install sanity-plugin-easy-preview
```

You'll also need to install `@sanity/preview-url-secret` for your frontend API route:

```sh
npm install @sanity/preview-url-secret
```

## Studio Configuration

Add the plugin to your `sanity.config.ts` (or .js):

```ts
import {defineConfig} from 'sanity'
import {easyPreview} from 'sanity-plugin-easy-preview'

export default defineConfig({
  // ...
  plugins: [
    easyPreview({
      // Base URL of your preview site (defaults to SANITY_STUDIO_PREVIEW_URL env var)
      previewUrl: 'http://localhost:3000',

      // API route path for draft validation (default: '/api/draft')
      draftRoute: '/api/draft',

      // Global default slug field (default: 'slug.current')
      slugField: 'slug.current',

      // Document types with preview enabled
      types: [
        {
          type: 'page',
          urlPrefix: '', // Homepage and pages at root level
        },
        {
          type: 'blogPost',
          urlPrefix: '/blog', // Blog posts prefixed with /blog
        },
        {
          type: 'product',
          urlPrefix: (doc) => `/products/${doc.category}`, // Dynamic prefix based on document
          slugField: 'productSlug.current', // Override global slugField for this type
        },
      ],
    }),
  ],
})
```

### Configuration Options

#### `previewUrl` (optional)

- **Type:** `string`
- **Default:** `process.env.SANITY_STUDIO_PREVIEW_URL`
- The base URL of your frontend site

#### `draftRoute` (optional)

- **Type:** `string`
- **Default:** `'/api/draft'`
- The API route path that handles preview validation

#### `slugField` (optional)

- **Type:** `string`
- **Default:** `'slug.current'`
- Global default path to the slug field in documents
- Supports dot notation: `'slug.current'`, `'meta.slug'`, `'pathname.current'`, etc.
- Can be overridden per document type in the `types` configuration

#### `types` (required)

- **Type:** `PreviewTypeConfig[]`
- Array of document types that should have preview enabled

Each type config has:

- `name` (required): The schema type name (e.g., `'page'`, `'blogPost'`)
- `urlPrefix` (optional): URL prefix for this document type
  - Can be a string: `'/blog'`
  - Or a function: `(doc) => '/products/' + doc.category`
- `slugField` (optional): Path to the slug field for this specific type
  - Overrides the global `slugField` setting
  - Supports dot notation: `'slug.current'`, `'meta.slug'`, etc.
  - If not set, uses the global `slugField` (default: `'slug.current'`)

### Environment Variables

You can set the preview URL via environment variable in `.env.local`:

```env
SANITY_STUDIO_PREVIEW_URL=http://localhost:3000
```

This is useful for different environments (development, staging, production).

## Frontend Setup

Your frontend needs to validate preview requests and enable draft mode. Here's how to set it up for different frameworks:

### Required Environment Variable

Create a read token in your Sanity project settings (Manage → API → Tokens) with **Viewer** permissions and add it to your frontend `.env.local`:

```env
SANITY_API_READ_TOKEN=sk...
```

⚠️ **Never commit this token to your repository!**

### Next.js App Router

Create an API route at `app/api/draft/route.ts`:

```ts
import {draftMode} from 'next/headers'
import {redirect} from 'next/navigation'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {client} from '@/sanity/lib/client' // Your Sanity client

const clientWithToken = client.withConfig({
  token: process.env.SANITY_API_READ_TOKEN,
})

export async function GET(request: Request) {
  const {isValid, redirectTo = '/'} = await validatePreviewUrl(clientWithToken, request.url)

  if (!isValid) {
    return new Response('Invalid secret', {status: 401})
  }

  draftMode().enable()
  redirect(redirectTo)
}
```

Create a disable route at `app/api/disable-draft/route.ts`:

```ts
import {draftMode} from 'next/headers'
import {NextRequest, NextResponse} from 'next/server'

export async function GET(request: NextRequest) {
  draftMode().disable()
  const url = new URL(request.nextUrl)
  return NextResponse.redirect(new URL('/', url.origin))
}
```

### Next.js Pages Router

Create an API route at `pages/api/draft.ts`:

```ts
import type {NextApiRequest, NextApiResponse} from 'next'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {client} from '@/lib/sanity.client'

const clientWithToken = client.withConfig({
  token: process.env.SANITY_API_READ_TOKEN,
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const {isValid, redirectTo = '/'} = await validatePreviewUrl(clientWithToken, req.url!)

  if (!isValid) {
    return res.status(401).send('Invalid secret')
  }

  res.setDraftMode({enable: true})
  res.writeHead(307, {Location: redirectTo})
  res.end()
}
```

### Astro

Create an API route at `src/pages/api/draft.ts`:

```ts
import type {APIRoute} from 'astro'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {getClient} from '@/lib/sanity'

const clientWithToken = getClient().withConfig({
  token: import.meta.env.SANITY_API_READ_TOKEN,
})

export const GET: APIRoute = async ({request, cookies, redirect}) => {
  const {isValid, redirectTo = '/'} = await validatePreviewUrl(clientWithToken, request.url)

  if (!isValid) {
    return new Response('Invalid secret', {status: 401})
  }

  // Set a secure cookie for draft mode
  cookies.set('__draft', 'true', {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
  })

  return redirect(redirectTo)
}
```

Create a disable route at `src/pages/api/disable-draft.ts`:

```ts
import type {APIRoute} from 'astro'

export const GET: APIRoute = async ({cookies, redirect}) => {
  // Delete the draft mode cookie
  cookies.delete('__draft', {
    path: '/',
  })

  return redirect('/')
}
```

### Fetching Draft Content

Once draft mode is enabled via the cookie, your data fetching code should use the `drafts` perspective:

#### Next.js Example

```ts
import {draftMode} from 'next/headers'
import {client} from '@/sanity/lib/client'

export async function getPage(slug: string) {
  const isDraft = draftMode().isEnabled

  return client.fetch(
    `*[_type == "page" && slug.current == $slug][0]`,
    {slug},
    {
      perspective: isDraft ? 'drafts' : 'published',
    },
  )
}
```

#### Astro Example

```ts
import {getClient} from '@/lib/sanity'

export async function getPage(slug: string, cookies: AstroCookies) {
  const isDraft = Boolean(cookies.get('__draft')?.value)

  return getClient().fetch(
    `*[_type == "page" && slug.current == $slug][0]`,
    {slug},
    {
      perspective: isDraft ? 'drafts' : 'published',
    },
  )
}
```

#### Sanity Client Setup

For the examples above, here's how to set up your Sanity client:

**Next.js** (`lib/sanity/client.ts` or `sanity/lib/client.ts`):

```ts
import {createClient} from 'next-sanity'

export const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  apiVersion: '2024-01-01',
  useCdn: false, // Set to false for draft mode
})
```

**Astro** (`lib/sanity.ts`):

```ts
import {sanityClient} from 'sanity:client'

export function getClient() {
  return sanityClient
}
```

Or if using `@sanity/client` directly:

```ts
import {createClient} from '@sanity/client'

const client = createClient({
  projectId: import.meta.env.PUBLIC_SANITY_PROJECT_ID,
  dataset: import.meta.env.PUBLIC_SANITY_DATASET,
  apiVersion: '2024-01-01',
  useCdn: false,
})

export function getClient() {
  return client
}
```

## How It Works

1. **User clicks Preview** in Sanity Studio
2. Plugin generates a **cryptographically secure secret** using WebCrypto API
3. Secret is stored as a `sanity.previewUrlSecret` document (draft) in your dataset with 1-hour TTL
4. User is redirected to `/api/draft?sanity-preview-secret=xxx&sanity-preview-pathname=/slug`
5. Your API route **validates the secret** against the dataset
6. If valid, a **secure HTTP-only cookie** is set
7. User is **redirected** to the intended page
8. Your frontend **detects the cookie** and fetches draft content using `perspective: 'drafts'`

## Security

- ✅ Secrets are **cryptographically random** (16 bytes → base64url)
- ✅ Secrets stored as **drafts only** (never published)
- ✅ **1-hour TTL** with automatic cleanup
- ✅ **HTTP-only cookies** prevent JavaScript access
- ✅ **Secure flag** in production (HTTPS only)
- ✅ **SameSite=Lax** protection
- ✅ Requires **Contributor role** to create secrets (can create drafts)
- ✅ Validation requires **read token** with Viewer permissions

## Troubleshooting

### Preview button doesn't appear

- Check that the document type is in your `types` configuration
- Verify the type `name` matches exactly

### "Missing slug" error

- Ensure your document has the slug field configured in `slugField`
- Check that the slug path is correct (e.g., `slug.current` vs just `slug`)

### "Invalid secret" error

- Verify `SANITY_API_READ_TOKEN` is set in your frontend environment
- Check that the token has Viewer or higher permissions
- Ensure your API route is correctly validating with `validatePreviewUrl`

### Preview shows published instead of draft content

- Check that your data fetching uses `perspective: 'drafts'` when draft mode is enabled
- Verify the cookie is being set correctly
- Test by checking browser DevTools → Application → Cookies

### Environment variable not found

- In Next.js, prefix with `NEXT_PUBLIC_` only if used in browser code
- For Astro, use `import.meta.env.SANITY_API_READ_TOKEN`
- Restart your dev server after adding environment variables

## License

[MIT](LICENSE) © Christian (Chrish) Dunne

## Develop & test

This plugin uses [@sanity/plugin-kit](https://github.com/sanity-io/plugin-kit)
with default configuration for build & watch scripts.

See [Testing a plugin in Sanity Studio](https://github.com/sanity-io/plugin-kit#testing-a-plugin-in-sanity-studio)
on how to run this plugin with hotreload in the studio.

### Release new version

Run ["CI & Release" workflow](https://github.com/Modular-Everything/sanity-plugin-easy-preview/actions/workflows/main.yml).
Make sure to select the main branch and check "Release new version".

Semantic release will only release on configured branches, so it is safe to run release on any branch.
