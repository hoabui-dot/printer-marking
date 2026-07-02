package dto

import (
	"time"

	"github.com/google/uuid"
)

// ─── Routing DTOs ─────────────────────────────────────────────────────────────

type CreateOperationRequest struct {
	Sequence         int      `json:"sequence" binding:"required,min=1"`
	Name             string   `json:"name" binding:"required,min=2,max=255"`
	MachineType      string   `json:"machine_type" binding:"max=100"`
	EstimatedMinutes int      `json:"estimated_minutes" binding:"min=0"`
	MinOperators     int      `json:"min_operators" binding:"required,min=1"`
	MaxOperators     int      `json:"max_operators" binding:"required,min=1"`
	RequiredSkills   []string `json:"required_skills"`
}

type CreateRoutingRequest struct {
	Name        string                   `json:"name" binding:"required,min=2,max=255"`
	Description string                   `json:"description" binding:"max=500"`
	Operations  []CreateOperationRequest  `json:"operations" binding:"required,min=1,dive"`
}

type OperationDTO struct {
	ID               uuid.UUID `json:"id"`
	RoutingID        uuid.UUID `json:"routing_id"`
	Sequence         int       `json:"sequence"`
	Name             string    `json:"name"`
	MachineType      string    `json:"machine_type"`
	EstimatedMinutes int       `json:"estimated_minutes"`
	MinOperators     int       `json:"min_operators"`
	MaxOperators     int       `json:"max_operators"`
	RequiredSkills   []string  `json:"required_skills"`
}

type RoutingDTO struct {
	ID                     uuid.UUID      `json:"id"`
	Name                   string         `json:"name"`
	Description            string         `json:"description"`
	Operations             []OperationDTO `json:"operations"`
	TotalEstimatedMinutes  int            `json:"total_estimated_minutes"`
	CreatedAt              time.Time      `json:"created_at"`
	UpdatedAt              time.Time      `json:"updated_at"`
}

// ─── Production Order DTOs ────────────────────────────────────────────────────

type CreateProductionOrderRequest struct {
	OrderNumber   string  `json:"order_number" binding:"required,min=2,max=100"`
	ProductName   string  `json:"product_name" binding:"required,min=2,max=255"`
	Quantity      int     `json:"quantity" binding:"required,min=1"`
	Priority      int     `json:"priority" binding:"required,min=1,max=100"`
	OperationType string  `json:"operation_type" binding:"required,oneof=PRINT_ONLY MARK_ONLY PRINT_AND_MARK"`
	Station       string  `json:"station" binding:"required,min=2,max=100"`
	DueDate       *string `json:"due_date"` // optional YYYY-MM-DD
	Notes         string  `json:"notes" binding:"max=1000"`
}

type UpdatePriorityRequest struct {
	Priority int `json:"priority" binding:"required,min=1,max=100"`
}

type ProductionOrderEventDTO struct {
	ID                uuid.UUID `json:"id"`
	ProductionOrderID uuid.UUID `json:"production_order_id"`
	EventType         string    `json:"event_type"`
	Status            string    `json:"status"`
	Message           string    `json:"message"`
	OccurredAt        time.Time `json:"occurred_at"`
}

type ProductionOrderDTO struct {
	ID             uuid.UUID                 `json:"id"`
	OrderNumber    string                    `json:"order_number"`
	ProductName    string                    `json:"product_name"`
	Quantity       int                       `json:"quantity"`
	Priority       int                       `json:"priority"`
	Status         string                    `json:"status"`
	OperationType  string                    `json:"operation_type"`
	Station        string                    `json:"station"`
	GatewayOrderID *string                   `json:"gateway_order_id,omitempty"`
	DueDate        *time.Time                `json:"due_date,omitempty"`
	Notes          string                    `json:"notes,omitempty"`
	Events         []ProductionOrderEventDTO `json:"events,omitempty"`
	CreatedAt      time.Time                 `json:"created_at"`
	UpdatedAt      time.Time                 `json:"updated_at"`
}

type GatewayEventPayload struct {
	JobNo             string    `json:"job_no" binding:"required"`
	ProductionOrderID string    `json:"production_order_id"`
	OrderNumber       string    `json:"order_number"`
	Status            string    `json:"status" binding:"required"`
	Message           string    `json:"message" binding:"required"`
	OccurredAt        time.Time `json:"occurred_at" binding:"required"`
}

// ─── Work Order DTOs ──────────────────────────────────────────────────────────

type CreateWorkOrderRequest struct {
	ProductionOrderID string `json:"production_order_id" binding:"required,uuid"`
	RoutingID         string `json:"routing_id" binding:"required,uuid"`
	Sequence          int    `json:"sequence" binding:"required,min=1"`
}

type WorkOrderDTO struct {
	ID                uuid.UUID  `json:"id"`
	ProductionOrderID uuid.UUID  `json:"production_order_id"`
	RoutingID         uuid.UUID  `json:"routing_id"`
	Sequence          int        `json:"sequence"`
	Status            string     `json:"status"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}
