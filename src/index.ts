import type {SanityClient} from '@sanity/client'
import {EyeOpenIcon} from '@sanity/icons'
import {useToast} from '@sanity/ui'
import {uuid} from '@sanity/uuid'
import {useCallback} from 'react'
import type {DocumentActionComponent, SanityDocument} from 'sanity'
import {definePlugin, useClient} from 'sanity'

/**
 * Configuration for a preview-enabled document type
 * @public
 */
export interface PreviewTypeConfig {
  /** The schema type name (e.g., 'page', 'blogPost') */
  type: string
  /** URL prefix for this document type - can be a string or function that receives the document */
  urlPrefix?: string | ((doc: SanityDocument) => string)
  /** Path to the slug field in the document (default: 'slug.current') */
  slugField?: string
}

/**
 * Plugin configuration
 * @public
 */
export interface EasyPreviewConfig {
  /** Base URL of your preview site (defaults to SANITY_STUDIO_PREVIEW_URL env var) */
  previewUrl?: string
  /** API route path for draft validation (default: '/api/draft') */
  draftRoute?: string
  /** Global default path to the slug field (default: 'slug.current'). Can be overridden per-type. */
  slugField?: string
  /** Document types that should have preview enabled */
  types: PreviewTypeConfig[]
}

/**
 * Generate a cryptographically secure random secret for preview URL validation
 */
function generateUrlSecret(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)

    let key = ''
    for (let i = 0; i < array.length; i++) {
      key += array[i]!.toString(16).padStart(2, '0')
    }

    // Convert to base64url encoding (URL-safe)
    return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '')
  }

  // Fallback for environments without crypto (less secure)
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

/**
 * Extract a value from an object using dot notation (e.g., 'slug.current')
 */
function getSlugValue(doc: SanityDocument | undefined, path: string): string | null {
  if (!doc || !path) return null

  const parts = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = doc

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part]
    } else {
      return null
    }
  }

  return typeof value === 'string' ? value : null
}

/**
 * Delete expired preview secrets (older than 1 hour)
 */
async function cleanupExpiredSecrets(client: SanityClient): Promise<void> {
  try {
    await client.delete({
      query: `*[_type == "sanity.previewUrlSecret" && dateTime(_updatedAt) <= dateTime(now()) - 3600]`,
    })
  } catch (error) {
    // Silently fail - cleanup is not critical
    console.warn('Failed to cleanup expired preview secrets:', error)
  }
}

/**
 * Easy Preview plugin for Sanity Studio
 *
 * Adds a "Preview" button to configured document types that securely opens
 * your frontend site with draft content enabled.
 *
 * @example
 * ```ts
 * import {defineConfig} from 'sanity'
 * import {easyPreview} from 'sanity-plugin-easy-preview'
 *
 * export default defineConfig({
 *   // ...
 *   plugins: [
 *     easyPreview({
 *       previewUrl: 'http://localhost:3000',
 *       types: [
 *         { type: 'page', urlPrefix: '' },
 *         { type: 'blogPost', urlPrefix: '/blog' }
 *       ]
 *     })
 *   ],
 * })
 * ```
 *
 * @public
 */
export const easyPreview = definePlugin<EasyPreviewConfig>((config) => {
  const {
    previewUrl = typeof process === 'undefined' ? undefined : process.env.SANITY_STUDIO_PREVIEW_URL,
    draftRoute = '/api/draft',
    types = [],
  } = config

  if (!previewUrl) {
    console.warn(
      'sanity-plugin-easy-preview: No previewUrl configured. Set SANITY_STUDIO_PREVIEW_URL or pass previewUrl in config.',
    )
  }

  // Create a map of type names to their configs for quick lookup
  const typeConfigMap = new Map<string, PreviewTypeConfig>()
  types.forEach((typeConfig) => {
    typeConfigMap.set(typeConfig.type, typeConfig)
  })

  const PreviewAction: DocumentActionComponent = (props) => {
    const {id, type, draft, published} = props
    const client = useClient({apiVersion: '2025-02-19'})
    const toast = useToast()

    const handlePreview = useCallback(async () => {
      try {
        const typeConfig = typeConfigMap.get(type)
        if (!typeConfig) {
          toast.push({
            status: 'error',
            title: 'Preview not configured',
            description: `No preview configuration found for document type "${type}"`,
          })
          return
        }

        const document = draft || published
        if (!document) {
          toast.push({
            status: 'error',
            title: 'No document found',
            description: 'Cannot preview: document not found',
          })
          return
        }

        // Extract slug from document
        const slugField = typeConfig.slugField || config.slugField || 'slug.current'
        const slug = getSlugValue(document, slugField)

        if (!slug) {
          toast.push({
            status: 'error',
            title: 'Missing slug',
            description: `Document missing required field: ${slugField}`,
          })
          return
        }

        // Generate cryptographically secure secret
        const secret = generateUrlSecret()
        const secretId = uuid()

        // Create the secret document
        const secretDoc = {
          _id: `drafts.${secretId}`,
          _type: 'sanity.previewUrlSecret',
          secret: secret,
          source: id,
          studioUrl: typeof window === 'undefined' ? '' : window.location.origin,
        }

        // Save secret to dataset
        await client
          .transaction()
          .createOrReplace(secretDoc)
          .commit({tag: 'sanity.preview-url-secret'})

        // Clean up expired secrets in the background
        cleanupExpiredSecrets(client).catch(() => {
          // Ignore cleanup errors
        })

        // Resolve URL prefix
        let urlPrefix = ''
        if (typeConfig.urlPrefix) {
          urlPrefix =
            typeof typeConfig.urlPrefix === 'function'
              ? typeConfig.urlPrefix(document)
              : typeConfig.urlPrefix
        }

        // Construct preview URL
        const url = new URL(draftRoute, previewUrl)
        url.searchParams.set('sanity-preview-secret', secret)

        // Build the pathname: /prefix/slug
        const pathname = urlPrefix ? `${urlPrefix}/${slug}` : `/${slug}`
        url.searchParams.set('sanity-preview-pathname', pathname)

        // Open preview in new tab
        window.open(url.toString(), '_blank')

        toast.push({
          status: 'success',
          title: 'Preview opened',
          description: 'Opening preview in new tab...',
        })
      } catch (error) {
        console.error('Preview failed:', error)
        toast.push({
          status: 'error',
          title: 'Preview failed',
          description: error instanceof Error ? error.message : 'An unknown error occurred',
        })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, type, draft, published, client, toast])

    // Only show action for configured types
    if (!typeConfigMap.has(type)) {
      return null
    }

    return {
      label: 'Preview',
      icon: EyeOpenIcon,
      onHandle: handlePreview,
      disabled: !draft && !published,
    }
  }

  return {
    name: 'sanity-plugin-easy-preview',
    document: {
      actions: (prev) => {
        // Find the publish action and insert preview after it
        const publishIndex = prev.findIndex((action) => action.action === 'publish')
        if (publishIndex >= 0) {
          return [
            ...prev.slice(0, publishIndex + 1),
            PreviewAction,
            ...prev.slice(publishIndex + 1),
          ]
        }
        // If publish action not found, append to end
        return [...prev, PreviewAction]
      },
    },
  }
})
