package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/nd/mes-platform/modules/production/application/dto"
	"github.com/nd/mes-platform/modules/production/domain/entity"
	"github.com/nd/mes-platform/modules/production/domain/repository"
	"github.com/nd/mes-platform/pkg/logger"
	"github.com/nd/mes-platform/shared/domain"
	"github.com/nd/mes-platform/shared/outbox"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrConflict   = errors.New("conflict")
	ErrValidation = errors.New("validation error")
	ErrTransition = errors.New("invalid status transition")
)

type OutboxRepository interface {
	Save(ctx context.Context, event *outbox.Event) error
}

type ProductionService struct {
	orderRepo   repository.ProductionOrderRepository
	workRepo    repository.WorkOrderRepository
	routingRepo repository.RoutingRepository
	outboxRepo  OutboxRepository
	log         *logger.Logger
}

func NewProductionService(
	orderRepo repository.ProductionOrderRepository,
	workRepo repository.WorkOrderRepository,
	routingRepo repository.RoutingRepository,
	outboxRepo OutboxRepository,
	log *logger.Logger,
) *ProductionService {
	return &ProductionService{
		orderRepo:   orderRepo,
		workRepo:    workRepo,
		routingRepo: routingRepo,
		outboxRepo:  outboxRepo,
		log:         log.With(logger.Module("production")),
	}
}

// ─── Routing Use Cases ────────────────────────────────────────────────────────

func (s *ProductionService) CreateRouting(ctx context.Context, req dto.CreateRoutingRequest) (*dto.RoutingDTO, error) {
	if existing, _ := s.routingRepo.FindByName(ctx, req.Name); existing != nil {
		return nil, fmt.Errorf("%w: routing with name %q already exists", ErrConflict, req.Name)
	}

	// Build operation value objects
	ops := make([]entity.Operation, 0, len(req.Operations))
	for _, opReq := range req.Operations {
		op, err := entity.NewOperation(
			uuid.Nil, // routing ID assigned by NewRouting
			opReq.Sequence,
			opReq.Name,
			opReq.MachineType,
			opReq.EstimatedMinutes,
			opReq.MinOperators,
			opReq.MaxOperators,
			opReq.RequiredSkills,
		)
		if err != nil {
			return nil, fmt.Errorf("%w: operation seq %d: %s", ErrValidation, opReq.Sequence, err.Error())
		}
		ops = append(ops, *op)
	}

	routing, err := entity.NewRouting(req.Name, req.Description, ops)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrValidation, err.Error())
	}

	if err := s.routingRepo.Save(ctx, routing); err != nil {
		return nil, err
	}

	return mapRoutingToDTO(routing), nil
}

func (s *ProductionService) GetRouting(ctx context.Context, id uuid.UUID) (*dto.RoutingDTO, error) {
	r, err := s.routingRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return mapRoutingToDTO(r), nil
}

func (s *ProductionService) ListRoutings(ctx context.Context) ([]*dto.RoutingDTO, error) {
	routings, err := s.routingRepo.List(ctx)
	if err != nil {
		return nil, err
	}
	dtos := make([]*dto.RoutingDTO, len(routings))
	for i, r := range routings {
		dtos[i] = mapRoutingToDTO(r)
	}
	return dtos, nil
}

// ─── Production Order Use Cases ───────────────────────────────────────────────

func (s *ProductionService) CreateProductionOrder(ctx context.Context, req dto.CreateProductionOrderRequest) (*dto.ProductionOrderDTO, error) {
	if existing, _ := s.orderRepo.FindByOrderNumber(ctx, req.OrderNumber); existing != nil {
		return nil, fmt.Errorf("%w: order number %q already exists", ErrConflict, req.OrderNumber)
	}

	var dueDate *time.Time
	if req.DueDate != nil && *req.DueDate != "" {
		t, err := time.Parse("2006-01-02", *req.DueDate)
		if err != nil {
			return nil, fmt.Errorf("%w: due_date must be in YYYY-MM-DD format", ErrValidation)
		}
		dueDate = &t
	}

	order, err := entity.NewProductionOrder(
		req.OrderNumber,
		req.ProductName,
		req.Quantity,
		req.Priority,
		dueDate,
		req.Notes,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrValidation, err.Error())
	}

	if err := s.orderRepo.Save(ctx, order); err != nil {
		return nil, err
	}

	_ = s.publishEvents(ctx, order.PullEvents())
	return mapOrderToDTO(order), nil
}

func (s *ProductionService) GetProductionOrder(ctx context.Context, id uuid.UUID) (*dto.ProductionOrderDTO, error) {
	order, err := s.orderRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return mapOrderToDTO(order), nil
}

func (s *ProductionService) ListProductionOrders(ctx context.Context, filter repository.ProductionOrderFilter) ([]*dto.ProductionOrderDTO, int64, error) {
	orders, total, err := s.orderRepo.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	dtos := make([]*dto.ProductionOrderDTO, len(orders))
	for i, o := range orders {
		dtos[i] = mapOrderToDTO(o)
	}
	return dtos, total, nil
}

func (s *ProductionService) ReleaseProductionOrder(ctx context.Context, id uuid.UUID) error {
	order, err := s.orderRepo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if err := order.Release(); err != nil {
		return fmt.Errorf("%w: %s", ErrTransition, err.Error())
	}
	if err := s.orderRepo.Save(ctx, order); err != nil {
		return err
	}
	_ = s.publishEvents(ctx, order.PullEvents())
	return nil
}

func (s *ProductionService) CancelProductionOrder(ctx context.Context, id uuid.UUID) error {
	order, err := s.orderRepo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if err := order.Cancel(); err != nil {
		return fmt.Errorf("%w: %s", ErrTransition, err.Error())
	}
	if err := s.orderRepo.Save(ctx, order); err != nil {
		return err
	}
	_ = s.publishEvents(ctx, order.PullEvents())
	return nil
}

func (s *ProductionService) UpdatePriority(ctx context.Context, id uuid.UUID, req dto.UpdatePriorityRequest) error {
	order, err := s.orderRepo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if err := order.UpdatePriority(req.Priority); err != nil {
		return fmt.Errorf("%w: %s", ErrValidation, err.Error())
	}
	return s.orderRepo.Save(ctx, order)
}

// ─── Work Order Use Cases ─────────────────────────────────────────────────────

func (s *ProductionService) CreateWorkOrder(ctx context.Context, req dto.CreateWorkOrderRequest) (*dto.WorkOrderDTO, error) {
	productionOrderID, err := uuid.Parse(req.ProductionOrderID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid production_order_id", ErrValidation)
	}
	routingID, err := uuid.Parse(req.RoutingID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid routing_id", ErrValidation)
	}

	// Verify production order exists and is released
	order, err := s.orderRepo.FindByID(ctx, productionOrderID)
	if err != nil {
		return nil, fmt.Errorf("%w: production order", ErrNotFound)
	}
	if order.Status != entity.OrderStatusReleased && order.Status != entity.OrderStatusInProgress {
		return nil, fmt.Errorf("%w: production order must be released or in_progress to create work orders", ErrTransition)
	}

	// Verify routing exists
	if _, err := s.routingRepo.FindByID(ctx, routingID); err != nil {
		return nil, fmt.Errorf("%w: routing", ErrNotFound)
	}

	wo, err := entity.NewWorkOrder(productionOrderID, routingID, req.Sequence)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrValidation, err.Error())
	}

	if err := s.workRepo.Save(ctx, wo); err != nil {
		return nil, err
	}

	_ = s.publishEvents(ctx, wo.PullEvents())
	return mapWorkOrderToDTO(wo), nil
}

func (s *ProductionService) GetWorkOrder(ctx context.Context, id uuid.UUID) (*dto.WorkOrderDTO, error) {
	wo, err := s.workRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return mapWorkOrderToDTO(wo), nil
}

func (s *ProductionService) ListWorkOrders(ctx context.Context, filter repository.WorkOrderFilter) ([]*dto.WorkOrderDTO, int64, error) {
	workOrders, total, err := s.workRepo.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	dtos := make([]*dto.WorkOrderDTO, len(workOrders))
	for i, wo := range workOrders {
		dtos[i] = mapWorkOrderToDTO(wo)
	}
	return dtos, total, nil
}

func (s *ProductionService) StartWorkOrder(ctx context.Context, id uuid.UUID) error {
	wo, err := s.workRepo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if err := wo.Start(); err != nil {
		return fmt.Errorf("%w: %s", ErrTransition, err.Error())
	}
	if err := s.workRepo.Save(ctx, wo); err != nil {
		return err
	}
	_ = s.publishEvents(ctx, wo.PullEvents())
	return nil
}

func (s *ProductionService) CompleteWorkOrder(ctx context.Context, id uuid.UUID) error {
	wo, err := s.workRepo.FindByID(ctx, id)
	if err != nil {
		return ErrNotFound
	}
	if err := wo.Complete(); err != nil {
		return fmt.Errorf("%w: %s", ErrTransition, err.Error())
	}
	if err := s.workRepo.Save(ctx, wo); err != nil {
		return err
	}
	_ = s.publishEvents(ctx, wo.PullEvents())
	return nil
}

// ─── Private helpers ──────────────────────────────────────────────────────────

func (s *ProductionService) publishEvents(ctx context.Context, events []domain.DomainEvent) error {
	for _, ev := range events {
		payload, err := outbox.MarshalEvent(ev)
		if err != nil {
			return err
		}
		outboxEvent := outbox.NewEvent(ev.EventName(), ev.EventName(), payload)
		if err := s.outboxRepo.Save(ctx, outboxEvent); err != nil {
			return err
		}
	}
	return nil
}

func mapRoutingToDTO(r *entity.Routing) *dto.RoutingDTO {
	ops := make([]dto.OperationDTO, len(r.Operations))
	for i, op := range r.Operations {
		ops[i] = dto.OperationDTO{
			ID:               op.ID,
			RoutingID:        op.RoutingID,
			Sequence:         op.Sequence,
			Name:             op.Name,
			MachineType:      op.MachineType,
			EstimatedMinutes: op.EstimatedMinutes,
			MinOperators:     op.MinOperators,
			MaxOperators:     op.MaxOperators,
			RequiredSkills:   op.RequiredSkills,
		}
	}
	return &dto.RoutingDTO{
		ID:                    r.ID,
		Name:                  r.Name,
		Description:           r.Description,
		Operations:            ops,
		TotalEstimatedMinutes: r.TotalEstimatedMinutes(),
		CreatedAt:             r.CreatedAt,
		UpdatedAt:             r.UpdatedAt,
	}
}

func mapOrderToDTO(o *entity.ProductionOrder) *dto.ProductionOrderDTO {
	return &dto.ProductionOrderDTO{
		ID:          o.ID,
		OrderNumber: o.OrderNumber,
		ProductName: o.ProductName,
		Quantity:    o.Quantity,
		Priority:    o.Priority,
		Status:      string(o.Status),
		DueDate:     o.DueDate,
		Notes:       o.Notes,
		CreatedAt:   o.CreatedAt,
		UpdatedAt:   o.UpdatedAt,
	}
}

func mapWorkOrderToDTO(wo *entity.WorkOrder) *dto.WorkOrderDTO {
	return &dto.WorkOrderDTO{
		ID:                wo.ID,
		ProductionOrderID: wo.ProductionOrderID,
		RoutingID:         wo.RoutingID,
		Sequence:          wo.Sequence,
		Status:            string(wo.Status),
		StartedAt:         wo.StartedAt,
		CompletedAt:       wo.CompletedAt,
		CreatedAt:         wo.CreatedAt,
		UpdatedAt:         wo.UpdatedAt,
	}
}
