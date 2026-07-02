package route

import (
	"github.com/gin-gonic/gin"
	"github.com/nd/mes-platform/modules/production/presentation/handler"
	"github.com/nd/mes-platform/pkg/jwt"
	"github.com/nd/mes-platform/shared/middleware"
)

func Register(
	router *gin.RouterGroup,
	h *handler.ProductionHandler,
	jwtManager *jwt.Manager,
) {
	protected := router.Group("").Use(middleware.Authenticate(jwtManager))

	// Routings
	protected.POST("/routings", h.CreateRouting)
	protected.GET("/routings", h.ListRoutings)
	protected.GET("/routings/:id", h.GetRouting)

	// Production Orders
	protected.POST("/production-orders", h.CreateProductionOrder)
	protected.GET("/production-orders", h.ListProductionOrders)
	protected.GET("/production-orders/:id", h.GetProductionOrder)
	protected.PATCH("/production-orders/:id/release", h.ReleaseProductionOrder)
	protected.PATCH("/production-orders/:id/cancel", h.CancelProductionOrder)
	protected.PATCH("/production-orders/:id/priority", h.UpdatePriority)

	// Work Orders
	protected.POST("/work-orders", h.CreateWorkOrder)
	protected.GET("/work-orders", h.ListWorkOrders)
	protected.GET("/work-orders/:id", h.GetWorkOrder)
	protected.PATCH("/work-orders/:id/start", h.StartWorkOrder)
	protected.PATCH("/work-orders/:id/complete", h.CompleteWorkOrder)
}
