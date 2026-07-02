package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/nd/mes-platform/modules/production/domain/entity"
)

var (
	ErrProductionOrderNotFound = errors.New("production order not found")
	ErrWorkOrderNotFound       = errors.New("work order not found")
	ErrRoutingNotFound         = errors.New("routing not found")
)

type ProductionOrderFilter struct {
	Status   string
	Priority int // 0 = no filter
	Page     int
	PageSize int
}

type WorkOrderFilter struct {
	ProductionOrderID *uuid.UUID
	Status            string
	Page              int
	PageSize          int
}

// ProductionOrderRepository manages persistence of production orders.
type ProductionOrderRepository interface {
	Save(ctx context.Context, order *entity.ProductionOrder) error
	FindByID(ctx context.Context, id uuid.UUID) (*entity.ProductionOrder, error)
	FindByOrderNumber(ctx context.Context, orderNumber string) (*entity.ProductionOrder, error)
	FindByGatewayOrderID(ctx context.Context, gatewayOrderID string) (*entity.ProductionOrder, error)
	List(ctx context.Context, filter ProductionOrderFilter) ([]*entity.ProductionOrder, int64, error)
}

// ProductionOrderEventRepository manages persistence of production order execution events.
type ProductionOrderEventRepository interface {
	Save(ctx context.Context, event *entity.ProductionOrderEvent) error
	ListByProductionOrderID(ctx context.Context, productionOrderID uuid.UUID) ([]*entity.ProductionOrderEvent, error)
}

// WorkOrderRepository manages persistence of work orders.
type WorkOrderRepository interface {
	Save(ctx context.Context, wo *entity.WorkOrder) error
	FindByID(ctx context.Context, id uuid.UUID) (*entity.WorkOrder, error)
	List(ctx context.Context, filter WorkOrderFilter) ([]*entity.WorkOrder, int64, error)
}

// RoutingRepository manages persistence of routings with their operations.
type RoutingRepository interface {
	Save(ctx context.Context, routing *entity.Routing) error
	FindByID(ctx context.Context, id uuid.UUID) (*entity.Routing, error)
	FindByName(ctx context.Context, name string) (*entity.Routing, error)
	List(ctx context.Context) ([]*entity.Routing, error)
}
