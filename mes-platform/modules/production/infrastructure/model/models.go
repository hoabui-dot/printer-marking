package model

import (
	"time"

	"github.com/google/uuid"
)

// ProductionOrderModel is the GORM model for production_orders.
type ProductionOrderModel struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey"`
	OrderNumber string     `gorm:"type:varchar(100);uniqueIndex;not null"`
	ProductName string     `gorm:"type:varchar(255);not null"`
	Quantity    int        `gorm:"not null;default:1"`
	Priority    int        `gorm:"not null;default:50"`
	Status      string     `gorm:"type:varchar(50);not null;default:'draft';index"`
	DueDate     *time.Time `gorm:"type:date;index"`
	Notes       string     `gorm:"type:text"`
	CreatedAt   time.Time  `gorm:"autoCreateTime"`
	UpdatedAt   time.Time  `gorm:"autoUpdateTime"`
}

func (ProductionOrderModel) TableName() string { return "production_orders" }

// RoutingModel is the GORM model for production_routings.
type RoutingModel struct {
	ID          uuid.UUID        `gorm:"type:uuid;primaryKey"`
	Name        string           `gorm:"type:varchar(255);uniqueIndex;not null"`
	Description string           `gorm:"type:text"`
	CreatedAt   time.Time        `gorm:"autoCreateTime"`
	UpdatedAt   time.Time        `gorm:"autoUpdateTime"`
	Operations  []OperationModel `gorm:"foreignKey:RoutingID;constraint:OnDelete:CASCADE"`
}

func (RoutingModel) TableName() string { return "production_routings" }

// OperationModel is the GORM model for production_operations.
// RequiredSkillsJSON stores the skill codes as a JSON-encoded string for DB compatibility.
type OperationModel struct {
	ID                 uuid.UUID `gorm:"type:uuid;primaryKey"`
	RoutingID          uuid.UUID `gorm:"type:uuid;not null;index"`
	Sequence           int       `gorm:"not null"`
	Name               string    `gorm:"type:varchar(255);not null"`
	MachineType        string    `gorm:"type:varchar(100);not null;default:''"`
	EstimatedMinutes   int       `gorm:"not null;default:0"`
	MinOperators       int       `gorm:"not null;default:1"`
	MaxOperators       int       `gorm:"not null;default:1"`
	RequiredSkillsJSON string    `gorm:"type:text;not null;default:'[]'"` // JSON array of skill codes
	CreatedAt          time.Time `gorm:"autoCreateTime"`
	UpdatedAt          time.Time `gorm:"autoUpdateTime"`
}

func (OperationModel) TableName() string { return "production_operations" }

// WorkOrderModel is the GORM model for production_work_orders.
type WorkOrderModel struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ProductionOrderID uuid.UUID  `gorm:"type:uuid;not null;index"`
	RoutingID         uuid.UUID  `gorm:"type:uuid;not null"`
	Sequence          int        `gorm:"not null;default:1"`
	Status            string     `gorm:"type:varchar(50);not null;default:'pending';index"`
	StartedAt         *time.Time `gorm:"default:null"`
	CompletedAt       *time.Time `gorm:"default:null"`
	CreatedAt         time.Time  `gorm:"autoCreateTime"`
	UpdatedAt         time.Time  `gorm:"autoUpdateTime"`
}

func (WorkOrderModel) TableName() string { return "production_work_orders" }

// OutboxEventModel is the GORM model for production_outbox_events.
type OutboxEventModel struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey"`
	EventName   string     `gorm:"type:varchar(255);not null;index"`
	RoutingKey  string     `gorm:"type:varchar(255);not null"`
	Payload     []byte     `gorm:"type:text;not null"`
	Status      string     `gorm:"type:varchar(50);not null;default:'pending';index"`
	RetryCount  int        `gorm:"not null;default:0"`
	Error       string     `gorm:"type:text"`
	PublishedAt *time.Time `gorm:"index"`
	CreatedAt   time.Time  `gorm:"autoCreateTime;index"`
	UpdatedAt   time.Time  `gorm:"autoUpdateTime"`
}

func (OutboxEventModel) TableName() string { return "production_outbox_events" }
