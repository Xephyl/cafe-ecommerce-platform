import { createHash } from "node:crypto"
import { AppError } from "../utils/AppError"
import { Product } from "../models/product.model"
import { redis, redisGet, redisSet, redisDel } from "../config/redis"
import { ProductStatus } from "@cafe/shared"
import type { CreateProductInput, UpdateProductInput } from "@cafe/shared"
import type { IProduct } from "../models/product.model"

const LIST_TTL   = 300  // 5 minutes
const DETAIL_TTL = 600  // 10 minutes

export interface ProductListQuery {
  category?:  string
  status?:    string
  search?:    string
  minPrice?:  string
  maxPrice?:  string
  sort?:      string
  page?:      string
  limit?:     string
  featured?:  string
}

export interface PaginatedProducts {
  items:      IProduct[]
  total:      number
  page:       number
  limit:      number
  totalPages: number
}

// MD5 of sorted query params produces a stable cache key regardless of
// the order query params arrive in (?sort=newest&category=x and
// ?category=x&sort=newest produce the same cache key).
function listCacheKey(query: ProductListQuery): string {
  const sorted = Object.fromEntries(
    Object.keys(query)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => [k, (query as Record<string, string>)[k]])
  )
  const hash = createHash("md5").update(JSON.stringify(sorted)).digest("hex")
  return `products:list:${hash}`
}

// Deletes all list cache keys and optionally the detail key for one slug.
// Uses redis.keys() which is fine at this scale. For very large datasets,
// use a Redis Set of tracked list keys instead of a glob scan.
async function invalidateProductCache(slug?: string): Promise<void> {
  try {
    const listKeys = await redis.keys("products:list:*")
    if (listKeys.length > 0) await redisDel(...listKeys)
  } catch {
    // Cache invalidation is best-effort — log is enough
  }
  if (slug) await redisDel(`products:slug:${slug}`)
}

// Creates a product. Category existence is not verified here — Mongoose will
// fail on populate if the ObjectId is invalid, which is enough for a cafe app.
export async function createProduct(input: CreateProductInput): Promise<IProduct> {
  const product = await Product.create(input)
  await invalidateProductCache()
  return product
}

// Public listing with filter, sort, and pagination.
// Results are cached by the MD5 of the query params.
// Status defaults to ACTIVE for public requests.
export async function getProducts(query: ProductListQuery): Promise<PaginatedProducts> {
  const cacheKey = listCacheKey(query)
  const cached   = await redisGet(cacheKey)
  if (cached) return JSON.parse(cached) as PaginatedProducts

  const page   = Math.max(1, Number.parseInt(query.page  ?? "1",  10))
  const limit  = Math.min(50, Math.max(1, Number.parseInt(query.limit ?? "12", 10)))
  const skip   = (page - 1) * limit

  const filter: Record<string, unknown> = {}

  // Status: default to ACTIVE for public routes.
  // Admin routes use the same endpoint — they pass status explicitly.
  filter.status = query.status ?? ProductStatus.ACTIVE

  if (query.category)               filter.category  = query.category
  if (query.featured === "true")    filter.isFeatured = true
  if (query.search)                 filter.$text      = { $search: query.search }
  if (query.minPrice || query.maxPrice) {
    const priceFilter: Record<string, number> = {}
    if (query.minPrice) priceFilter.$gte = Number.parseInt(query.minPrice, 10)
    if (query.maxPrice) priceFilter.$lte = Number.parseInt(query.maxPrice, 10)
    filter.basePrice = priceFilter
  }

  // Sort mapping
  let sort: Record<string, 1 | -1 | { $meta: string }> = { createdAt: -1 }
  switch (query.sort) {
    case "price_asc":  sort = { basePrice: 1 };                              break
    case "price_desc": sort = { basePrice: -1 };                             break
    case "newest":     sort = { createdAt: -1 };                             break
    case "popular":    sort = { reviewCount: -1, averageRating: -1 };        break
    case "relevance":  sort = { score: { $meta: "textScore" }, createdAt: -1 }; break
  }
  // When searching, sort by text score unless the caller specified a sort.
  if (query.search && !query.sort) {
    sort = { score: { $meta: "textScore" }, createdAt: -1 }
  }

  const projection = query.search
    ? { score: { $meta: "textScore" } }
    : undefined

  const [items, total] = await Promise.all([
    Product.find(filter, projection)
      .populate("category", "name slug")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ])

  const result: PaginatedProducts = {
    items:      items as unknown as IProduct[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }

  await redisSet(cacheKey, JSON.stringify(result), LIST_TTL)
  return result
}

// Public detail by slug. Cached individually per slug.
export async function getProductBySlug(slug: string): Promise<IProduct> {
  const cacheKey = `products:slug:${slug}`
  const cached   = await redisGet(cacheKey)
  if (cached) return JSON.parse(cached) as IProduct

  const product = await Product.findBySlug(slug)
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found")
  }

  await redisSet(cacheKey, JSON.stringify(product), DETAIL_TTL)
  return product
}

// Admin: partial update. Fetches then saves to trigger pre-save slug hook.
// Invalidates both list cache and the old slug's detail cache.
export async function updateProduct(
  id:    string,
  input: UpdateProductInput
): Promise<IProduct> {
  const product = await Product.findById(id)
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found")
  }

  const oldSlug = product.slug
  Object.assign(product, input)
  await product.save()

  await invalidateProductCache(oldSlug)
  if (product.slug !== oldSlug) await redisDel(`products:slug:${product.slug}`)

  return product
}

// Admin: soft delete — sets status to INACTIVE, never removes the document.
// Stock and history are preserved for reporting and audit purposes.
export async function deleteProduct(id: string): Promise<IProduct> {
  const product = await Product.findById(id)
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found")
  }

  product.status = ProductStatus.INACTIVE
  await product.save()

  await invalidateProductCache(product.slug)
  return product
}

// Admin: toggle between ACTIVE and INACTIVE.
export async function toggleProductStatus(id: string): Promise<IProduct> {
  const product = await Product.findById(id)
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found")
  }

  product.status =
    product.status === ProductStatus.ACTIVE
      ? ProductStatus.INACTIVE
      : ProductStatus.ACTIVE

  await product.save()
  await invalidateProductCache(product.slug)
  return product
}