package entity

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nd/mes-platform/shared/domain"
)

// ─── Production Order Status ──────────────────────────────────────────────────

type OrderStatus string

const (
	OrderStatusDraft      OrderStatus = "draft"
	OrderStatusReleased   OrderStatus = "released"
	OrderStatusInProgress OrderStatus = "in_progress"
	OrderStatusCompleted  OrderStatus = "completed"
	OrderStatusCancelled  OrderStatus = "cancelled"
)

// ─── Work Order Status ────────────────────────────────────────────────────────

type WorkOrderStatus string

const (
	WorkOrderStatusPending    WorkOrderStatus = "pending"
	WorkOrderStatusInProgress WorkOrderStatus = "in_progress"
	WorkOrderStatusCompleted  WorkOrderStatus = "completed"
	WorkOrderStatusCancelled  WorkOrderStatus = "cancelled"
)

// ─── Operation (Value Object) ─────────────────────────────────────────────────

// Operation is a step within a Routing. It is a Value Object owned by Routing.
type Operation struct {
	ID               uuid.UUID
	RoutingID        uuid.UUID
	Sequence         int
	Name             string
	MachineType      string
	EstimatedMinutes int
	MinOperators     int
	MaxOperators     int
	RequiredSkills   []string // skill codes from workforce module
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func NewOperation(routingID uuid.UUID, seq int, name, machineType string, estimatedMinutes, minOps, maxOps int, skills []string) (*Operation, error) {
	if seq <= 0 {
		return nil, errors.New("operation sequence must be greater than 0")
	}
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("operation name is required")
	}
	if estimatedMinutes < 0 {
		return nil, errors.New("estimated minutes cannot be negative")
	}
	if minOps < 1 {
		return nil, errors.New("min_operators must be at least 1")
	}
	if maxOps < minOps {
		return nil, fmt.Errorf("max_operators (%d) must be >= min_operators (%d)", maxOps, minOps)
	}

	now := time.Now().UTC()
	return &Operation{
		ID:               uuid.New(),
		RoutingID:        routingID,
		Sequence:         seq,
		Name:             strings.TrimSpace(name),
		MachineType:      strings.TrimSpace(machineType),
		EstimatedMinutes: estimatedMinutes,
		MinOperators:     minOps,
		MaxOperators:     maxOps,
		RequiredSkills:   skills,
		CreatedAt:        now,
		UpdatedAt:        now,
	}, nil
}

// ─── Routing ──────────────────────────────────────────────────────────────────

// Routing is a named sequence of Operations that defines how a product is manufactured.
type Routing struct {
	domain.BaseEntity
	Name        string
	Description string
	Operations  []Operation
}

func NewRouting(name, description string, operations []Operation) (*Routing, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("routing name is required")
	}
	if len(operations) == 0 {
		return nil, errors.New("routing must have at least one operation")
	}

	// Verify sequences are unique and positive
	seqSet := make(map[int]struct{})
	for _, op := range operations {
		if _, exists := seqSet[op.Sequence]; exists {
			return nil, fmt.Errorf("duplicate operation sequence: %d", op.Sequence)
		}
		seqSet[op.Sequence] = struct{}{}
	}

	r := &Routing{
		BaseEntity:  domain.NewBaseEntity(),
		Name:        strings.TrimSpace(name),
		Description: strings.TrimSpace(description),
		Operations:  operations,
	}

	// Assign routing ID to all operations
	for i := range r.Operations {
		r.Operations[i].RoutingID = r.ID
	}

	return r, nil
}

// TotalEstimatedMinutes sums all operation durations.
func (r *Routing) TotalEstimatedMinutes() int {
	total := 0
	for _, op := range r.Operations {
		total += op.EstimatedMinutes
	}
	return total
}

// ─── Production Order ─────────────────────────────────────────────────────────

// ProductionOrder is the top-level aggregate for manufacturing a product batch.
type ProductionOrder struct {
	domain.AggregateRoot
	OrderNumber string
	ProductName string
	Quantity    int
	Priority    int // 1 = lowest, 100 = highest
	Status      OrderStatus
	DueDate     *time.Time
	Notes       string
}

func NewProductionOrder(orderNumber, productName string, quantity, priority int, dueDate *time.Time, notes string) (*ProductionOrder, error) {
	if strings.TrimSpace(orderNumber) == "" {
		return nil, errors.New("order number is required")
	}
	if strings.TrimSpace(productName) == "" {
		return nil, errors.New("product name is required")
	}
	if quantity <= 0 {
		return nil, errors.New("quantity must be greater than 0")
	}
	if priority < 1 || priority > 100 {
		return nil, errors.New("priority must be between 1 and 100")
	}

	po := &ProductionOrder{
		OrderNumber: strings.TrimSpace(orderNumber),
		ProductName: strings.TrimSpace(productName),
		Quantity:    quantity,
		Priority:    priority,
		Status:      OrderStatusDraft,
		DueDate:     dueDate,
		Notes:       strings.TrimSpace(notes),
	}
	po.BaseEntity = domain.NewBaseEntity()
	po.RecordEvent(NewProductionOrderCreatedEvent(po.ID, po.OrderNumber, po.ProductName, po.Quantity))
	return po, nil
}

// Release transitions the order from draft to released (available for work orders).
func (po *ProductionOrder) Release() error {
	if po.Status != OrderStatusDraft {
		return fmt.Errorf("can only release a draft order, current status: %s", po.Status)
	}
	po.Status = OrderStatusReleased
	po.UpdatedAt = time.Now().UTC()
	po.RecordEvent(NewProductionOrderReleasedEvent(po.ID, po.OrderNumber))
	return nil
}

// Start transitions the order to in_progress.
func (po *ProductionOrder) Start() error {
	if po.Status != OrderStatusReleased {
		return fmt.Errorf("can only start a released order, current status: %s", po.Status)
	}
	po.Status = OrderStatusInProgress
	po.UpdatedAt = time.Now().UTC()
	return nil
}

// Complete marks the order as fully manufactured.
func (po *ProductionOrder) Complete() error {
	if po.Status != OrderStatusInProgress {
		return fmt.Errorf("can only complete an in-progress order, current status: %s", po.Status)
	}
	po.Status = OrderStatusCompleted
	po.UpdatedAt = time.Now().UTC()
	po.RecordEvent(NewProductionOrderCompletedEvent(po.ID, po.OrderNumber))
	return nil
}

// Cancel marks the order as cancelled. Only draft or released orders can be cancelled.
func (po *ProductionOrder) Cancel() error {
	if po.Status != OrderStatusDraft && po.Status != OrderStatusReleased {
		return fmt.Errorf("can only cancel a draft or released order, current status: %s", po.Status)
	}
	po.Status = OrderStatusCancelled
	po.UpdatedAt = time.Now().UTC()
	po.RecordEvent(NewProductionOrderCancelledEvent(po.ID, po.OrderNumber))
	return nil
}

// UpdatePriority changes the production order priority.
func (po *ProductionOrder) UpdatePriority(priority int) error {
	if priority < 1 || priority > 100 {
		return errors.New("priority must be between 1 and 100")
	}
	po.Priority = priority
	po.UpdatedAt = time.Now().UTC()
	return nil
}

// ─── Work Order ───────────────────────────────────────────────────────────────

// WorkOrder represents the execution of a specific Routing for a ProductionOrder.
type WorkOrder struct {
	domain.AggregateRoot
	ProductionOrderID uuid.UUID
	RoutingID         uuid.UUID
	Sequence          int
	Status            WorkOrderStatus
	StartedAt         *time.Time
	CompletedAt       *time.Time
}

func NewWorkOrder(productionOrderID, routingID uuid.UUID, sequence int) (*WorkOrder, error) {
	if sequence <= 0 {
		return nil, errors.New("work order sequence must be greater than 0")
	}

	wo := &WorkOrder{
		ProductionOrderID: productionOrderID,
		RoutingID:         routingID,
		Sequence:          sequence,
		Status:            WorkOrderStatusPending,
	}
	wo.BaseEntity = domain.NewBaseEntity()
	wo.RecordEvent(NewWorkOrderCreatedEvent(wo.ID, productionOrderID, routingID, sequence))
	return wo, nil
}

// Start transitions the work order to in_progress.
func (wo *WorkOrder) Start() error {
	if wo.Status != WorkOrderStatusPending {
		return fmt.Errorf("can only start a pending work order, current status: %s", wo.Status)
	}
	now := time.Now().UTC()
	wo.Status = WorkOrderStatusInProgress
	wo.StartedAt = &now
	wo.UpdatedAt = now
	wo.RecordEvent(NewWorkOrderStartedEvent(wo.ID, wo.ProductionOrderID))
	return nil
}

// Complete marks the work order as done.
func (wo *WorkOrder) Complete() error {
	if wo.Status != WorkOrderStatusInProgress {
		return fmt.Errorf("can only complete an in-progress work order, current status: %s", wo.Status)
	}
	now := time.Now().UTC()
	wo.Status = WorkOrderStatusCompleted
	wo.CompletedAt = &now
	wo.UpdatedAt = now
	wo.RecordEvent(NewWorkOrderCompletedEvent(wo.ID, wo.ProductionOrderID))
	return nil
}

// Cancel marks the work order as cancelled.
func (wo *WorkOrder) Cancel() error {
	if wo.Status == WorkOrderStatusCompleted || wo.Status == WorkOrderStatusCancelled {
		return fmt.Errorf("cannot cancel a %s work order", wo.Status)
	}
	wo.Status = WorkOrderStatusCancelled
	wo.UpdatedAt = time.Now().UTC()
	return nil
}
