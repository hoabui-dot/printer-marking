package service_test

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/nd/mes-platform/modules/production/application/dto"
	"github.com/nd/mes-platform/modules/production/application/service"
	"github.com/nd/mes-platform/modules/production/domain/entity"
	"github.com/nd/mes-platform/modules/production/domain/repository"
	"github.com/nd/mes-platform/modules/production/infrastructure/model"
	"github.com/nd/mes-platform/modules/production/infrastructure/persistence"
	"github.com/nd/mes-platform/pkg/logger"
	"github.com/nd/mes-platform/shared/outbox"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type MockOutboxRepository struct {
	Events []*outbox.Event
}

func (m *MockOutboxRepository) Save(_ context.Context, event *outbox.Event) error {
	m.Events = append(m.Events, event)
	return nil
}

type MockGatewayClient struct {
	SendFunc func(ctx context.Context, order *entity.ProductionOrder) (string, error)
}

func (m *MockGatewayClient) SendProductionOrder(ctx context.Context, order *entity.ProductionOrder) (string, error) {
	if m.SendFunc != nil {
		return m.SendFunc(ctx, order)
	}
	return "mock-gateway-order-id", nil
}

func setupProductionSvc(t *testing.T) (*gorm.DB, *MockOutboxRepository, *service.ProductionService) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	err = db.AutoMigrate(
		&model.ProductionOrderModel{},
		&model.ProductionOrderEventModel{},
		&model.RoutingModel{},
		&model.OperationModel{},
		&model.WorkOrderModel{},
		&model.OutboxEventModel{},
	)
	require.NoError(t, err)

	orderRepo := persistence.NewGormProductionOrderRepository(db)
	workRepo := persistence.NewGormWorkOrderRepository(db)
	routingRepo := persistence.NewGormRoutingRepository(db)
	eventRepo := persistence.NewGormProductionOrderEventRepository(db)
	outboxRepo := &MockOutboxRepository{}
	log := logger.NewNop()
	gatewayCli := &MockGatewayClient{}

	svc := service.NewProductionService(orderRepo, workRepo, routingRepo, eventRepo, outboxRepo, gatewayCli, log)
	return db, outboxRepo, svc
}

func createTestRouting(t *testing.T, svc *service.ProductionService, name string) *dto.RoutingDTO {
	t.Helper()
	r, err := svc.CreateRouting(context.Background(), dto.CreateRoutingRequest{
		Name:        name,
		Description: "Test routing",
		Operations: []dto.CreateOperationRequest{
			{Sequence: 1, Name: "Plate Making", MachineType: "CTP", EstimatedMinutes: 60, MinOperators: 1, MaxOperators: 2},
			{Sequence: 2, Name: "Printing", MachineType: "Offset Press", EstimatedMinutes: 90, MinOperators: 2, MaxOperators: 4, RequiredSkills: []string{"LO1"}},
		},
	})
	require.NoError(t, err)
	return r
}

// ─── Routing Tests ────────────────────────────────────────────────────────────

func TestProductionService_CreateRouting(t *testing.T) {
	_, _, svc := setupProductionSvc(t)

	r, err := svc.CreateRouting(context.Background(), dto.CreateRoutingRequest{
		Name:        "Offset Standard",
		Description: "Standard offset print workflow",
		Operations: []dto.CreateOperationRequest{
			{Sequence: 1, Name: "Pre-press", EstimatedMinutes: 45, MinOperators: 1, MaxOperators: 2},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "Offset Standard", r.Name)
	assert.Equal(t, 1, len(r.Operations))
	assert.Equal(t, 45, r.TotalEstimatedMinutes)

	// Conflict
	_, err = svc.CreateRouting(context.Background(), dto.CreateRoutingRequest{
		Name:       "Offset Standard",
		Operations: []dto.CreateOperationRequest{{Sequence: 1, Name: "Op", MinOperators: 1, MaxOperators: 1}},
	})
	assert.ErrorIs(t, err, service.ErrConflict)
}

// ─── Production Order Tests ───────────────────────────────────────────────────

func TestProductionService_CreateProductionOrder(t *testing.T) {
	_, outboxRepo, svc := setupProductionSvc(t)

	dueDate := "2026-08-01"
	order, err := svc.CreateProductionOrder(context.Background(), dto.CreateProductionOrderRequest{
		OrderNumber:   "PO-2026-001",
		ProductName:   "Wedding Invitation Cards",
		Quantity:      500,
		Priority:      80,
		OperationType: "PRINT_AND_MARK",
		Station:       "Station-Combined-01",
		DueDate:       &dueDate,
		Notes:         "High priority customer",
	})
	require.NoError(t, err)
	assert.Equal(t, "PO-2026-001", order.OrderNumber)
	assert.Equal(t, "draft", order.Status)
	assert.Equal(t, 80, order.Priority)

	// Outbox event published
	assert.Len(t, outboxRepo.Events, 1)
	assert.Equal(t, "mes.production.ProductionOrderCreated", outboxRepo.Events[0].EventName)

	// Conflict on duplicate order number
	_, err = svc.CreateProductionOrder(context.Background(), dto.CreateProductionOrderRequest{
		OrderNumber:   "PO-2026-001",
		ProductName:   "Duplicate",
		Quantity:      1,
		Priority:      1,
		OperationType: "PRINT_AND_MARK",
		Station:       "Station-Combined-01",
	})
	assert.ErrorIs(t, err, service.ErrConflict)
}

func TestProductionService_OrderLifecycle(t *testing.T) {
	_, outboxRepo, svc := setupProductionSvc(t)

	order, err := svc.CreateProductionOrder(context.Background(), dto.CreateProductionOrderRequest{
		OrderNumber:   "PO-LIFE-001",
		ProductName:   "Brochures",
		Quantity:      1000,
		Priority:      50,
		OperationType: "PRINT_AND_MARK",
		Station:       "Station-Combined-01",
	})
	require.NoError(t, err)
	outboxRepo.Events = nil

	// Release
	err = svc.ReleaseProductionOrder(context.Background(), order.ID)
	require.NoError(t, err)
	assert.Len(t, outboxRepo.Events, 1)
	assert.Equal(t, "mes.production.ProductionOrderReleased", outboxRepo.Events[0].EventName)

	// Verify status
	got, err := svc.GetProductionOrder(context.Background(), order.ID)
	require.NoError(t, err)
	assert.Equal(t, "sent_to_gateway", got.Status)

	outboxRepo.Events = nil

	// Cancel
	err = svc.CancelProductionOrder(context.Background(), order.ID)
	require.NoError(t, err)
	assert.Len(t, outboxRepo.Events, 1)
	assert.Equal(t, "mes.production.ProductionOrderCancelled", outboxRepo.Events[0].EventName)
}

// ─── Work Order Tests ─────────────────────────────────────────────────────────

func TestProductionService_WorkOrder_Lifecycle(t *testing.T) {
	_, outboxRepo, svc := setupProductionSvc(t)

	// Create routing
	routing := createTestRouting(t, svc, "WO Test Routing")

	// Create & release production order
	order, err := svc.CreateProductionOrder(context.Background(), dto.CreateProductionOrderRequest{
		OrderNumber:   "PO-WO-001",
		ProductName:   "Flyers",
		Quantity:      200,
		Priority:      60,
		OperationType: "PRINT_AND_MARK",
		Station:       "Station-Combined-01",
	})
	require.NoError(t, err)
	require.NoError(t, svc.ReleaseProductionOrder(context.Background(), order.ID))
	outboxRepo.Events = nil

	// Create work order
	wo, err := svc.CreateWorkOrder(context.Background(), dto.CreateWorkOrderRequest{
		ProductionOrderID: order.ID.String(),
		RoutingID:         routing.ID.String(),
		Sequence:          1,
	})
	require.NoError(t, err)
	assert.Equal(t, "pending", wo.Status)
	assert.Len(t, outboxRepo.Events, 1)
	assert.Equal(t, "mes.production.WorkOrderCreated", outboxRepo.Events[0].EventName)
	outboxRepo.Events = nil

	// Start work order
	err = svc.StartWorkOrder(context.Background(), wo.ID)
	require.NoError(t, err)
	assert.Len(t, outboxRepo.Events, 1)
	assert.Equal(t, "mes.production.WorkOrderStarted", outboxRepo.Events[0].EventName)
	outboxRepo.Events = nil

	// Complete work order
	err = svc.CompleteWorkOrder(context.Background(), wo.ID)
	require.NoError(t, err)
	assert.Len(t, outboxRepo.Events, 1)
	assert.Equal(t, "mes.production.WorkOrderCompleted", outboxRepo.Events[0].EventName)

	// Verify final state
	got, err := svc.GetWorkOrder(context.Background(), wo.ID)
	require.NoError(t, err)
	assert.Equal(t, "completed", got.Status)
	assert.NotNil(t, got.StartedAt)
	assert.NotNil(t, got.CompletedAt)
}

func TestProductionService_WorkOrder_DraftOrderBlocked(t *testing.T) {
	_, _, svc := setupProductionSvc(t)

	routing := createTestRouting(t, svc, "Blocked Routing")

	order, err := svc.CreateProductionOrder(context.Background(), dto.CreateProductionOrderRequest{
		OrderNumber:   "PO-BLOCKED",
		ProductName:   "Test",
		Quantity:      1,
		Priority:      1,
		OperationType: "PRINT_AND_MARK",
		Station:       "Station-Combined-01",
	})
	require.NoError(t, err)

	// Cannot create work order on draft production order
	_, err = svc.CreateWorkOrder(context.Background(), dto.CreateWorkOrderRequest{
		ProductionOrderID: order.ID.String(),
		RoutingID:         routing.ID.String(),
		Sequence:          1,
	})
	assert.ErrorIs(t, err, service.ErrTransition)
}

func TestProductionService_ListWorkOrders_ByProductionOrder(t *testing.T) {
	_, _, svc := setupProductionSvc(t)

	routing := createTestRouting(t, svc, "List Routing")
	order, _ := svc.CreateProductionOrder(context.Background(), dto.CreateProductionOrderRequest{
		OrderNumber:   "PO-LIST-001",
		ProductName:   "Test",
		Quantity:      100,
		Priority:      50,
		OperationType: "PRINT_AND_MARK",
		Station:       "Station-Combined-01",
	})
	svc.ReleaseProductionOrder(context.Background(), order.ID)

	// Create 2 work orders
	svc.CreateWorkOrder(context.Background(), dto.CreateWorkOrderRequest{
		ProductionOrderID: order.ID.String(),
		RoutingID:         routing.ID.String(),
		Sequence:          1,
	})
	svc.CreateWorkOrder(context.Background(), dto.CreateWorkOrderRequest{
		ProductionOrderID: order.ID.String(),
		RoutingID:         routing.ID.String(),
		Sequence:          2,
	})

	// List by production order ID
	list, total, err := svc.ListWorkOrders(context.Background(), repository.WorkOrderFilter{
		ProductionOrderID: &order.ID,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, list, 2)

	// Verify ordered by sequence
	assert.Equal(t, 1, list[0].Sequence)
	assert.Equal(t, 2, list[1].Sequence)
}
