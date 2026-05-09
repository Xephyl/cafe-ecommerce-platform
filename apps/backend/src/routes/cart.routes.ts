import { Router } from "express"
import { optionalAuth } from "../middleware/optionalAuth"
import { validate } from "../middleware/validate"
import { getCart, addItem, updateItem, removeItem, clearCart, applyCoupon } from "../controllers/cart.controller"
import { AddToCartSchema, UpdateCartItemSchema, ApplyCouponSchema } from "@cafe/shared"

const router = Router()

// All cart routes accept both authenticated users and guests.
// optionalAuth populates req.user if a valid Bearer token is present.
// If no token, the request continues as a guest (sessionId cookie).
router.get("/",                  optionalAuth, getCart)
router.post("/items",            optionalAuth, validate(AddToCartSchema),      addItem)
router.patch("/items/:itemId",   optionalAuth, validate(UpdateCartItemSchema),  updateItem)
router.delete("/items/:itemId",  optionalAuth, removeItem)
router.delete("/",               optionalAuth, clearCart)
router.post("/coupon",           optionalAuth, validate(ApplyCouponSchema),    applyCoupon)

export { router as cartRoutes }