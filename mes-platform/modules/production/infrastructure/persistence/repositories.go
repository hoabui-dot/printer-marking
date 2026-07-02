package persistence

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/nd/mes-platform/modules/production/domain/entity"
	"github.com/nd/mes-platform/modules/production/domain/repository"
	"github.com/nd/mes-platform/modules/production/infrastructure/model"
	"github.com/nd/mes-platform/shared/outbox"
	"gorm.io/gorm"
)

// ─── Production Order Repository ──────────────────────────────────────────────

type GormProductionOrderRepository struct {
	db *gorm.DB
}

func NewGormProductionOrderRepository(db *gorm.DB) *GormProductionOrderRepository {
	return &GormProductionOrderRepository{db: db}
}

func (r *GormProductionOrderRepository) Save(ctx context.Context, order *entity.ProductionOrder) error {
	m := productionOrderToModel(order)
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *GormProductionOrderRepository) FindByID(ctx context.Context, id uuid.UUID) (*entity.ProductionOrder, error) {
	var m model.ProductionOrderModel
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, repository.ErrProductionOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	return modelToProductionOrder(&m), nil
}

func (r *GormProductionOrderRepository) FindByOrderNumber(ctx context.Context, orderNumber string) (*entity.ProductionOrder, error) {
	var m model.ProductionOrderModel
	err := r.db.WithContext(ctx).Where("order_number = ?", orderNumber).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, repository.ErrProductionOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	return modelToProductionOrder(&m), nil
}

func (r *GormProductionOrderRepository) FindByGatewayOrderID(ctx context.Context, gatewayOrderID string) (*entity.ProductionOrder, error) {
	var m model.ProductionOrderModel
	err := r.db.WithContext(ctx).Where("gateway_order_id = ?", gatewayOrderID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, repository.ErrProductionOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	return modelToProductionOrder(&m), nil
}

func (r *GormProductionOrderRepository) List(ctx context.Context, filter repository.ProductionOrderFilter) ([]*entity.ProductionOrder, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.ProductionOrderModel{})

	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Priority > 0 {
		query = query.Where("priority = ?", filter.Priority)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	page, pageSize := filter.Page, filter.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	var models []model.ProductionOrderModel
	err := query.
		Offset((page-1)*pageSize).
		Limit(pageSize).
		Order("priority DESC, created_at DESC").
		Find(&models).Error
	if err != nil {
		return nil, 0, err
	}

	orders := make([]*entity.ProductionOrder, len(models))
	for i, m := range models {
		orders[i] = modelToProductionOrder(&m)
	}
	return orders, total, nil
}

// ─── Routing Repository ────────────────────────────────────────────────────────

type GormRoutingRepository struct {
	db *gorm.DB
}

func NewGormRoutingRepository(db *gorm.DB) *GormRoutingRepository {
	return &GormRoutingRepository{db: db}
}

func (r *GormRoutingRepository) Save(ctx context.Context, routing *entity.Routing) error {
	m := routingToModel(routing)
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Upsert the routing itself
		if err := tx.Save(&model.RoutingModel{
			ID:          m.ID,
			Name:        m.Name,
			Description: m.Description,
			CreatedAt:   m.CreatedAt,
			UpdatedAt:   m.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		// Replace all operations
		if err := tx.Where("routing_id = ?", m.ID).Delete(&model.OperationModel{}).Error; err != nil {
			return err
		}
		if len(m.Operations) > 0 {
			if err := tx.Create(&m.Operations).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *GormRoutingRepository) FindByID(ctx context.Context, id uuid.UUID) (*entity.Routing, error) {
	var m model.RoutingModel
	err := r.db.WithContext(ctx).
		Preload("Operations").
		Where("id = ?", id).
		First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, repository.ErrRoutingNotFound
	}
	if err != nil {
		return nil, err
	}
	return modelToRouting(&m), nil
}

func (r *GormRoutingRepository) FindByName(ctx context.Context, name string) (*entity.Routing, error) {
	var m model.RoutingModel
	err := r.db.WithContext(ctx).
		Preload("Operations").
		Where("name = ?", name).
		First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, repository.ErrRoutingNotFound
	}
	if err != nil {
		return nil, err
	}
	return modelToRouting(&m), nil
}

func (r *GormRoutingRepository) List(ctx context.Context) ([]*entity.Routing, error) {
	var models []model.RoutingModel
	err := r.db.WithContext(ctx).
		Preload("Operations").
		Order("name ASC").
		Find(&models).Error
	if err != nil {
		return nil, err
	}
	routings := make([]*entity.Routing, len(models))
	for i, m := range models {
		routings[i] = modelToRouting(&m)
	}
	return routings, nil
}

// ─── Work Order Repository ─────────────────────────────────────────────────────

type GormWorkOrderRepository struct {
	db *gorm.DB
}

func NewGormWorkOrderRepository(db *gorm.DB) *GormWorkOrderRepository {
	return &GormWorkOrderRepository{db: db}
}

func (r *GormWorkOrderRepository) Save(ctx context.Context, wo *entity.WorkOrder) error {
	m := workOrderToModel(wo)
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *GormWorkOrderRepository) FindByID(ctx context.Context, id uuid.UUID) (*entity.WorkOrder, error) {
	var m model.WorkOrderModel
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, repository.ErrWorkOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	return modelToWorkOrder(&m), nil
}

func (r *GormWorkOrderRepository) List(ctx context.Context, filter repository.WorkOrderFilter) ([]*entity.WorkOrder, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.WorkOrderModel{})

	if filter.ProductionOrderID != nil {
		query = query.Where("production_order_id = ?", *filter.ProductionOrderID)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	page, pageSize := filter.Page, filter.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	var models []model.WorkOrderModel
	err := query.
		Offset((page-1)*pageSize).
		Limit(pageSize).
		Order("sequence ASC, created_at DESC").
		Find(&models).Error
	if err != nil {
		return nil, 0, err
	}

	workOrders := make([]*entity.WorkOrder, len(models))
	for i, m := range models {
		workOrders[i] = modelToWorkOrder(&m)
	}
	return workOrders, total, nil
}

// ─── Outbox Repository ────────────────────────────────────────────────────────

type GormOutboxRepository struct {
	db *gorm.DB
}

func NewGormOutboxRepository(db *gorm.DB) *GormOutboxRepository {
	return &GormOutboxRepository{db: db}
}

func (r *GormOutboxRepository) Save(ctx context.Context, event *outbox.Event) error {
	m := &model.OutboxEventModel{
		ID:          event.ID,
		EventName:   event.EventName,
		RoutingKey:  event.RoutingKey,
		Payload:     event.Payload,
		Status:      string(event.Status),
		RetryCount:  event.RetryCount,
		Error:       event.Error,
		CreatedAt:   event.CreatedAt,
		UpdatedAt:   event.UpdatedAt,
	}
	return r.db.WithContext(ctx).Create(m).Error
}

// ─── Production Order Event Repository ────────────────────────────────────────

type GormProductionOrderEventRepository struct {
	db *gorm.DB
}

func NewGormProductionOrderEventRepository(db *gorm.DB) *GormProductionOrderEventRepository {
	return &GormProductionOrderEventRepository{db: db}
}

func (r *GormProductionOrderEventRepository) Save(ctx context.Context, event *entity.ProductionOrderEvent) error {
	m := productionOrderEventToModel(event)
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *GormProductionOrderEventRepository) ListByProductionOrderID(ctx context.Context, productionOrderID uuid.UUID) ([]*entity.ProductionOrderEvent, error) {
	var models []model.ProductionOrderEventModel
	err := r.db.WithContext(ctx).
		Where("production_order_id = ?", productionOrderID).
		Order("occurred_at ASC, created_at ASC").
		Find(&models).Error
	if err != nil {
		return nil, err
	}

	events := make([]*entity.ProductionOrderEvent, len(models))
	for i, m := range models {
		events[i] = modelToProductionOrderEvent(&m)
	}
	return events, nil
}
