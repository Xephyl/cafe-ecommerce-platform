import type { Request, Response } from "express"
import { asyncHandler } from "../utils/asyncHandler"
import { apiResponse } from "../utils/apiResponse"
import { AppError } from "../utils/AppError"
import { UserRole } from "@cafe/shared"
import * as orderService from "../services/order.service"

// POST /api/orders
// Authenticated users only. Places an order from the user's current cart.
export const placeOrder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, "TOKEN_MISSING", "Authentication required")

  const order = await orderService.placeOrder(req.user.id, req.body)
  res.status(201).json(apiResponse.success(order))
})

// GET /api/orders/my-orders
// Returns the authenticated user's order history (paginated).
export const getMyOrders = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, "TOKEN_MISSING", "Authentication required")

  const page  = Number.parseInt(req.query.page  as string ?? "1",  10)
  const limit = Number.parseInt(req.query.limit as string ?? "10", 10)
  const result = await orderService.getMyOrders(req.user.id, page, limit)
  res.status(200).json(apiResponse.success(result))
})

// GET /api/orders/:id
// Customers can only fetch their own orders.
// Admins can fetch any order (ownership check bypassed).
export const getOrderById = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError(401, "TOKEN_MISSING", "Authentication required")

  const isAdmin = req.user.role === UserRole.ADMIN
  const order   = await orderService.getOrderById(req.params.id, req.user.id, isAdmin)
  res.status(200).json(apiResponse.success(order))
})
