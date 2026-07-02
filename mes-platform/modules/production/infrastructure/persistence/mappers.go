package persistence

import (
	"encoding/json"

	"github.com/nd/mes-platform/modules/production/domain/entity"
	"github.com/nd/mes-platform/modules/production/infrastructure/model"
	"github.com/nd/mes-platform/shared/domain"
)

// ─── Model → Entity ───────────────────────────────────────────────────────────

func modelToProductionOrder(m *model.ProductionOrderModel) *entity.ProductionOrder {
	o := &entity.ProductionOrder{
		OrderNumber: m.OrderNumber,
		ProductName: m.ProductName,
		Quantity:    m.Quantity,
		Priority:    m.Priority,
		Status:      entity.OrderStatus(m.Status),
		DueDate:     m.DueDate,
		Notes:       m.Notes,
	}
	o.BaseEntity = domain.BaseEntity{
		ID:        m.ID,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
	return o
}

func modelToRouting(m *model.RoutingModel) *entity.Routing {
	ops := make([]entity.Operation, len(m.Operations))
	for i, opM := range m.Operations {
		ops[i] = modelToOperation(opM)
	}
	r := &entity.Routing{
		Name:        m.Name,
		Description: m.Description,
		Operations:  ops,
	}
	r.BaseEntity = domain.BaseEntity{
		ID:        m.ID,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
	return r
}

func modelToOperation(m model.OperationModel) entity.Operation {
	var skills []string
	_ = json.Unmarshal([]byte(m.RequiredSkillsJSON), &skills)
	if skills == nil {
		skills = []string{}
	}
	return entity.Operation{
		ID:               m.ID,
		RoutingID:        m.RoutingID,
		Sequence:         m.Sequence,
		Name:             m.Name,
		MachineType:      m.MachineType,
		EstimatedMinutes: m.EstimatedMinutes,
		MinOperators:     m.MinOperators,
		MaxOperators:     m.MaxOperators,
		RequiredSkills:   skills,
		CreatedAt:        m.CreatedAt,
		UpdatedAt:        m.UpdatedAt,
	}
}

func modelToWorkOrder(m *model.WorkOrderModel) *entity.WorkOrder {
	wo := &entity.WorkOrder{
		ProductionOrderID: m.ProductionOrderID,
		RoutingID:         m.RoutingID,
		Sequence:          m.Sequence,
		Status:            entity.WorkOrderStatus(m.Status),
		StartedAt:         m.StartedAt,
		CompletedAt:       m.CompletedAt,
	}
	wo.BaseEntity = domain.BaseEntity{
		ID:        m.ID,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
	return wo
}

// ─── Entity → Model ───────────────────────────────────────────────────────────

func productionOrderToModel(e *entity.ProductionOrder) *model.ProductionOrderModel {
	return &model.ProductionOrderModel{
		ID:          e.ID,
		OrderNumber: e.OrderNumber,
		ProductName: e.ProductName,
		Quantity:    e.Quantity,
		Priority:    e.Priority,
		Status:      string(e.Status),
		DueDate:     e.DueDate,
		Notes:       e.Notes,
		CreatedAt:   e.CreatedAt,
		UpdatedAt:   e.UpdatedAt,
	}
}

func routingToModel(e *entity.Routing) *model.RoutingModel {
	ops := make([]model.OperationModel, len(e.Operations))
	for i, op := range e.Operations {
		ops[i] = operationToModel(op)
	}
	return &model.RoutingModel{
		ID:          e.ID,
		Name:        e.Name,
		Description: e.Description,
		CreatedAt:   e.CreatedAt,
		UpdatedAt:   e.UpdatedAt,
		Operations:  ops,
	}
}

func operationToModel(e entity.Operation) model.OperationModel {
	skills := e.RequiredSkills
	if skills == nil {
		skills = []string{}
	}
	skillsJSON, _ := json.Marshal(skills)
	return model.OperationModel{
		ID:                 e.ID,
		RoutingID:          e.RoutingID,
		Sequence:           e.Sequence,
		Name:               e.Name,
		MachineType:        e.MachineType,
		EstimatedMinutes:   e.EstimatedMinutes,
		MinOperators:       e.MinOperators,
		MaxOperators:       e.MaxOperators,
		RequiredSkillsJSON: string(skillsJSON),
		CreatedAt:          e.CreatedAt,
		UpdatedAt:          e.UpdatedAt,
	}
}

func workOrderToModel(e *entity.WorkOrder) *model.WorkOrderModel {
	return &model.WorkOrderModel{
		ID:                e.ID,
		ProductionOrderID: e.ProductionOrderID,
		RoutingID:         e.RoutingID,
		Sequence:          e.Sequence,
		Status:            string(e.Status),
		StartedAt:         e.StartedAt,
		CompletedAt:       e.CompletedAt,
		CreatedAt:         e.CreatedAt,
		UpdatedAt:         e.UpdatedAt,
	}
}
