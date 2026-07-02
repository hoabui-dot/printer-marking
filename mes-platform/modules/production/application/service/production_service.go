package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
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

type GatewayClient interface {
	SendProductionOrder(ctx context.Context, order *entity.ProductionOrder) (string, error)
}

type ProductionService struct {
	orderRepo   repository.ProductionOrderRepository
	workRepo    repository.WorkOrderRepository
	routingRepo repository.RoutingRepository
	eventRepo   repository.ProductionOrderEventRepository
	outboxRepo  OutboxRepository
	gatewayCli  GatewayClient
	log         *logger.Logger

	mu          sync.RWMutex
	subscribers map[string]chan *dto.ProductionOrderDTO
}

func NewProductionService(
	orderRepo repository.ProductionOrderRepository,
	workRepo repository.WorkOrderRepository,
	routingRepo repository.RoutingRepository,
	eventRepo repository.ProductionOrderEventRepository,
	outboxRepo OutboxRepository,
	gatewayCli GatewayClient,
	log *logger.Logger,
) *ProductionService {
	return &ProductionService{
		orderRepo:   orderRepo,
		workRepo:    workRepo,
		routingRepo: routingRepo,
		eventRepo:   eventRepo,
		outboxRepo:  outboxRepo,
		gatewayCli:  gatewayCli,
		log:         log.With(logger.Module("production")),
		subscribers: make(map[string]chan *dto.ProductionOrderDTO),
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
		req.OperationType,
		req.Station,
		dueDate,
		req.Notes,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrValidation, err.Error())
	}

	if err := s.orderRepo.Save(ctx, order); err != nil {
		return nil, err
	}

	// Create initial timeline event
	initEvent := entity.NewProductionOrderEvent(order.ID, "OrderCreated", "draft", "Đơn hàng sản xuất được tạo ở dạng nháp.", time.Now())
	if err := s.eventRepo.Save(ctx, initEvent); err != nil {
		s.log.Error("failed to save initial production order timeline event", logger.Err(err))
	}

	_ = s.publishEvents(ctx, order.PullEvents())
	return mapOrderToDTO(order), nil
}

func (s *ProductionService) GetProductionOrder(ctx context.Context, id uuid.UUID) (*dto.ProductionOrderDTO, error) {
	order, err := s.orderRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	events, err := s.eventRepo.ListByProductionOrderID(ctx, id)
	if err != nil {
		s.log.Error("failed to list production order events", logger.Err(err))
	}

	orderDTO := mapOrderToDTO(order)
	if len(events) > 0 {
		orderDTO.Events = make([]dto.ProductionOrderEventDTO, len(events))
		for i, ev := range events {
			orderDTO.Events[i] = dto.ProductionOrderEventDTO{
				ID:                ev.ID,
				ProductionOrderID: ev.ProductionOrderID,
				EventType:         ev.EventType,
				Status:            ev.Status,
				Message:           ev.Message,
				OccurredAt:        ev.OccurredAt,
			}
		}
	}
	return orderDTO, nil
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

	// Create Release event in timeline
	relEvent := entity.NewProductionOrderEvent(order.ID, "OrderReleased", "released", "Đơn hàng được phê duyệt và phát hành.", time.Now())
	_ = s.eventRepo.Save(ctx, relEvent)

	// Send to Gateway
	gatewayID, err := s.gatewayCli.SendProductionOrder(ctx, order)
	if err != nil {
		s.log.Error("failed to send production order to gateway", logger.Err(err))
		failEvent := entity.NewProductionOrderEvent(order.ID, "GatewayTransmissionFailed", "released", fmt.Sprintf("Không thể gửi đơn hàng đến Gateway: %s. Sẵn sàng để gửi lại.", err.Error()), time.Now())
		_ = s.eventRepo.Save(ctx, failEvent)
	} else {
		if err := order.SentToGateway(gatewayID); err == nil {
			_ = s.orderRepo.Save(ctx, order)
			sentEvent := entity.NewProductionOrderEvent(order.ID, "SentToGateway", "sent_to_gateway", fmt.Sprintf("Đã gửi đơn hàng đến Gateway thành công. Gateway Order ID: %s", gatewayID), time.Now())
			_ = s.eventRepo.Save(ctx, sentEvent)
		}
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
	if order.Status != entity.OrderStatusReleased &&
		order.Status != entity.OrderStatusSentToGateway &&
		order.Status != entity.OrderStatusAccepted &&
		order.Status != entity.OrderStatusInProgress {
		return nil, fmt.Errorf("%w: production order must be released, sent_to_gateway, accepted, or in_progress to create work orders", ErrTransition)
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
		ID:             o.ID,
		OrderNumber:    o.OrderNumber,
		ProductName:    o.ProductName,
		Quantity:       o.Quantity,
		Priority:       o.Priority,
		Status:         string(o.Status),
		OperationType:  o.OperationType,
		Station:        o.Station,
		GatewayOrderID: o.GatewayOrderID,
		DueDate:        o.DueDate,
		Notes:          o.Notes,
		CreatedAt:      o.CreatedAt,
		UpdatedAt:      o.UpdatedAt,
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

// ProcessGatewayEvent handles webhook status events sent from the Gateway.
func (s *ProductionService) ProcessGatewayEvent(ctx context.Context, req dto.GatewayEventPayload) error {
	var order *entity.ProductionOrder
	var err error

	// 1. Try lookup by ProductionOrderID if provided
	if req.ProductionOrderID != "" {
		if id, parseErr := uuid.Parse(req.ProductionOrderID); parseErr == nil {
			order, err = s.orderRepo.FindByID(ctx, id)
		}
	}

	// 2. Try lookup by OrderNumber if provided and not yet found
	if (order == nil || err != nil) && req.OrderNumber != "" {
		order, err = s.orderRepo.FindByOrderNumber(ctx, req.OrderNumber)
	}

	// 3. Try lookup by GatewayOrderID
	if order == nil || err != nil {
		order, err = s.orderRepo.FindByGatewayOrderID(ctx, req.JobNo)
	}

	// 4. Fallback to parsing JobNo as UUID
	if order == nil || err != nil {
		if id, parseErr := uuid.Parse(req.JobNo); parseErr == nil {
			order, err = s.orderRepo.FindByID(ctx, id)
		}
	}

	if err != nil || order == nil {
		return fmt.Errorf("process gateway event: order not found for job_no %s (order_id: %s, order_no: %s)", req.JobNo, req.ProductionOrderID, req.OrderNumber)
	}

	// If gateway order ID is not set on the entity yet (race condition), set it now
	if order.GatewayOrderID == nil || *order.GatewayOrderID == "" {
		_ = order.SentToGateway(req.JobNo)
	}

	var timelineStatus string
	var transitionErr error
	switch req.Status {
	case "QUEUED":
		timelineStatus = "queued"
		transitionErr = order.SentToGateway(req.JobNo)
	case "ACCEPTED":
		timelineStatus = "accepted"
		transitionErr = order.Accept()
	case "PROCESSING":
		timelineStatus = "in_progress"
		transitionErr = order.Start()
	case "COMPLETED":
		timelineStatus = "completed"
		transitionErr = order.Complete()
	case "FAILED":
		timelineStatus = "failed"
		transitionErr = order.Fail()
	default:
		timelineStatus = "in_progress"
	}

	if transitionErr != nil {
		s.log.Warn("state transition warning in gateway event processing", logger.Err(transitionErr))
	}

	if err := s.orderRepo.Save(ctx, order); err != nil {
		return err
	}

	// Add timeline event
	ev := entity.NewProductionOrderEvent(order.ID, "GatewayStatusUpdated", timelineStatus, req.Message, req.OccurredAt)
	if err := s.eventRepo.Save(ctx, ev); err != nil {
		s.log.Error("failed to save gateway event in timeline", logger.Err(err))
	}

	// Broadcast updated Order DTO to SSE subscribers
	s.broadcastOrderUpdate(ctx, order.ID)

	return nil
}

func (s *ProductionService) Subscribe(clientID string) <-chan *dto.ProductionOrderDTO {
	ch := make(chan *dto.ProductionOrderDTO, 10)
	s.mu.Lock()
	s.subscribers[clientID] = ch
	s.mu.Unlock()
	return ch
}

func (s *ProductionService) Unsubscribe(clientID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ch, ok := s.subscribers[clientID]; ok {
		close(ch)
		delete(s.subscribers, clientID)
	}
}

func (s *ProductionService) broadcastOrderUpdate(ctx context.Context, id uuid.UUID) {
	orderDTO, err := s.GetProductionOrder(ctx, id)
	if err != nil {
		s.log.Error("failed to get production order for broadcast", logger.Err(err))
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, ch := range s.subscribers {
		select {
		case ch <- orderDTO:
		default:
			// channel is full, skip
		}
	}
}
