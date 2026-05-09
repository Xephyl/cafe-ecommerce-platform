import { v4 as uuid } from "uuid"
import type { Request, Response } from "express"
import { asyncHandler } from "../utils/asyncHandler"
import { apiResponse } from "../utils/apiResponse"
import { config } from "../config/index"
import * as cartService from "../services/cart.service"
import type { CartIdentity } from "../services/cart.service"

const SESSION_COOKIE = "sessionId"
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days in ms

const SESSION_COOKIE_OPTIONS = {
  signed:   true,
  httpOnly: true,
  sameSite: "lax" as const,  // lax (not strict) so the cookie survives redirects
  maxAge:   SESSION_MAX_AGE,
  path:     "/",
  secret:   config.jwt.refreshSecret,  // Must match cookie-parser secret
}

// Resolves who owns this cart request and ensures a sessionId cookie exists
// for guest callers. Returns a CartIdentity and the resolved sessionId (if guest).
function resolveIdentity(req: Request, res: Response): {
  identity:  CartIdentity
  sessionId: string | undefined
} {
  if (req.user) {
    return { identity: { type: "user", userId: req.user.id }, sessionId: undefined }
  }

  let sessionId = req.signedCookies[SESSION_COOKIE] as string | undefined
  if (!sessionId) {
    sessionId = uuid()
    res.cookie(SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTIONS)
  }
  return { identity: { type: "session", sessionId }, sessionId }
}

// GET /api/cart
export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const { identity } = resolveIdentity(req, res)
  const cart = await cartService.getCart(identity)
  res.status(200).json(apiResponse.success(cart))
})

// POST /api/cart/items
export const addItem = asyncHandler(async (req: Request, res: Response) => {
  const { identity } = resolveIdentity(req, res)
  const { productId, variantId, quantity } = req.body as {
    productId: string
    variantId: string
    quantity:  number
  }
  const cart = await cartService.addItem(identity, productId, variantId, quantity)
  res.status(200).json(apiResponse.success(cart))
})

// PATCH /api/cart/items/:itemId
export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const { identity } = resolveIdentity(req, res)
  const { quantity } = req.body as { quantity: number }
  const cart = await cartService.updateItem(identity, req.params.itemId, quantity)
  res.status(200).json(apiResponse.success(cart))
})

// DELETE /api/cart/items/:itemId
export const removeItem = asyncHandler(async (req: Request, res: Response) => {
  const { identity } = resolveIdentity(req, res)
  const cart = await cartService.removeItem(identity, req.params.itemId)
  res.status(200).json(apiResponse.success(cart))
})

// DELETE /api/cart
export const clearCart = asyncHandler(async (req: Request, res: Response) => {
  const { identity } = resolveIdentity(req, res)
  const cart = await cartService.clearCart(identity)
  res.status(200).json(apiResponse.success(cart))
})

// POST /api/cart/coupon
export const applyCoupon = asyncHandler(async (req: Request, res: Response) => {
  const { identity } = resolveIdentity(req, res)
  const { code } = req.body as { code: string }
  const cart = await cartService.applyCoupon(identity, code)
  res.status(200).json(apiResponse.success(cart))
})