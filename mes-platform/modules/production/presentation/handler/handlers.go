package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/nd/mes-platform/modules/production/application/dto"
	"github.com/nd/mes-platform/modules/production/application/service"
	"github.com/nd/mes-platform/modules/production/domain/repository"
	"github.com/nd/mes-platform/shared/pagination"
	"github.com/nd/mes-platform/shared/response"
)

type ProductionHandler struct {
	svc *service.ProductionService
}

func NewProductionHandler(svc *service.ProductionService) *ProductionHandler {
	return &ProductionHandler{svc: svc}
}

// ─── Routing Endpoints ────────────────────────────────────────────────────────

func (h *ProductionHandler) CreateRouting(c *gin.Context) {
	var req dto.CreateRoutingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "VALIDATION_ERROR", err.Error())
		return
	}
	r, err := h.svc.CreateRouting(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, service.ErrConflict) {
			response.Conflict(c, err.Error())
			return
		}
		response.BadRequest(c, "BAD_REQUEST", err.Error())
		return
	}
	response.Created(c, r)
}

func (h *ProductionHandler) ListRoutings(c *gin.Context) {
	routings, err := h.svc.ListRoutings(c.Request.Context())
	if err != nil {
		response.InternalServerError(c, c.GetString("trace_id"))
		return
	}
	response.OK(c, routings)
}

func (h *ProductionHandler) GetRouting(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid routing ID format")
		return
	}
	r, err := h.svc.GetRouting(c.Request.Context(), id)
	if err != nil {
		response.NotFound(c, "routing")
		return
	}
	response.OK(c, r)
}

// ─── Production Order Endpoints ───────────────────────────────────────────────

func (h *ProductionHandler) CreateProductionOrder(c *gin.Context) {
	var req dto.CreateProductionOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "VALIDATION_ERROR", err.Error())
		return
	}
	order, err := h.svc.CreateProductionOrder(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, service.ErrConflict) {
			response.Conflict(c, err.Error())
			return
		}
		response.BadRequest(c, "BAD_REQUEST", err.Error())
		return
	}
	response.Created(c, order)
}

func (h *ProductionHandler) GetProductionOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid production order ID format")
		return
	}
	order, err := h.svc.GetProductionOrder(c.Request.Context(), id)
	if err != nil {
		response.NotFound(c, "production order")
		return
	}
	response.OK(c, order)
}

func (h *ProductionHandler) ListProductionOrders(c *gin.Context) {
	p := pagination.FromContext(c)
	filter := repository.ProductionOrderFilter{
		Status:   c.Query("status"),
		Page:     p.Page,
		PageSize: p.PageSize,
	}
	orders, total, err := h.svc.ListProductionOrders(c.Request.Context(), filter)
	if err != nil {
		response.InternalServerError(c, c.GetString("trace_id"))
		return
	}
	response.List(c, orders, p.Page, p.PageSize, total)
}

func (h *ProductionHandler) ReleaseProductionOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid production order ID format")
		return
	}
	if err := h.svc.ReleaseProductionOrder(c.Request.Context(), id); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.NotFound(c, "production order")
			return
		}
		response.UnprocessableEntity(c, "INVALID_TRANSITION", err.Error())
		return
	}
	response.NoContent(c)
}

func (h *ProductionHandler) CancelProductionOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid production order ID format")
		return
	}
	if err := h.svc.CancelProductionOrder(c.Request.Context(), id); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.NotFound(c, "production order")
			return
		}
		response.UnprocessableEntity(c, "INVALID_TRANSITION", err.Error())
		return
	}
	response.NoContent(c)
}

func (h *ProductionHandler) UpdatePriority(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid production order ID format")
		return
	}
	var req dto.UpdatePriorityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.svc.UpdatePriority(c.Request.Context(), id, req); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.NotFound(c, "production order")
			return
		}
		response.BadRequest(c, "BAD_REQUEST", err.Error())
		return
	}
	response.NoContent(c)
}

// ─── Work Order Endpoints ─────────────────────────────────────────────────────

func (h *ProductionHandler) CreateWorkOrder(c *gin.Context) {
	var req dto.CreateWorkOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "VALIDATION_ERROR", err.Error())
		return
	}
	wo, err := h.svc.CreateWorkOrder(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.NotFound(c, "production order or routing")
			return
		}
		if errors.Is(err, service.ErrTransition) {
			response.UnprocessableEntity(c, "INVALID_TRANSITION", err.Error())
			return
		}
		response.BadRequest(c, "BAD_REQUEST", err.Error())
		return
	}
	response.Created(c, wo)
}

func (h *ProductionHandler) GetWorkOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid work order ID format")
		return
	}
	wo, err := h.svc.GetWorkOrder(c.Request.Context(), id)
	if err != nil {
		response.NotFound(c, "work order")
		return
	}
	response.OK(c, wo)
}

func (h *ProductionHandler) ListWorkOrders(c *gin.Context) {
	p := pagination.FromContext(c)
	filter := repository.WorkOrderFilter{
		Status:   c.Query("status"),
		Page:     p.Page,
		PageSize: p.PageSize,
	}
	if poID := c.Query("production_order_id"); poID != "" {
		if id, err := uuid.Parse(poID); err == nil {
			filter.ProductionOrderID = &id
		}
	}
	workOrders, total, err := h.svc.ListWorkOrders(c.Request.Context(), filter)
	if err != nil {
		response.InternalServerError(c, c.GetString("trace_id"))
		return
	}
	response.List(c, workOrders, p.Page, p.PageSize, total)
}

func (h *ProductionHandler) StartWorkOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid work order ID format")
		return
	}
	if err := h.svc.StartWorkOrder(c.Request.Context(), id); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.NotFound(c, "work order")
			return
		}
		response.UnprocessableEntity(c, "INVALID_TRANSITION", err.Error())
		return
	}
	response.NoContent(c)
}

func (h *ProductionHandler) CompleteWorkOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "INVALID_ID", "invalid work order ID format")
		return
	}
	if err := h.svc.CompleteWorkOrder(c.Request.Context(), id); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.NotFound(c, "work order")
			return
		}
		response.UnprocessableEntity(c, "INVALID_TRANSITION", err.Error())
		return
	}
	response.NoContent(c)
}
