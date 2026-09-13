package httpcontract_test

import (
	"testing"

	"github.com/thalesraymond/galaxify-monorepo/pkg/httpcontract"
)

// services is the canonical set of service short names with OpenAPI documents.
var services = []string{"user", "daily", "ship", "expedition"}

func TestOpenAPISpecsValidate(t *testing.T) {
	for _, service := range services {
		t.Run(service, func(t *testing.T) {
			doc := httpcontract.LoadSpec(t, service)

			if len(httpcontract.ImplementedOperations(t, doc)) == 0 {
				t.Fatalf("openapi: %s has no implemented operations", service)
			}

			seen := make(map[string]string)
			for path, item := range doc.Paths.Map() {
				for method, op := range item.Operations() {
					if op.OperationID == "" {
						t.Errorf("openapi: %s %s %s has no operationId", service, method, path)
						continue
					}
					if previous, ok := seen[op.OperationID]; ok {
						t.Errorf("openapi: %s operationId %q is duplicated; first used by %s, again by %s %s",
							service, op.OperationID, previous, method, path)
					}
					seen[op.OperationID] = method + " " + path
				}
			}
		})
	}
}

func TestOpenAPIPlannedOperationsAreExplicit(t *testing.T) {
	for _, service := range services {
		t.Run(service, func(t *testing.T) {
			doc := httpcontract.LoadSpec(t, service)
			for _, op := range httpcontract.PlannedOperations(t, doc) {
				item := doc.Paths.Value(op.Path)
				operation := item.GetOperation(op.Method)
				if operation == nil {
					t.Fatalf("openapi: %s planned operation %s not found", service, op)
				}
				if operation.Extensions["x-planned-changes"] == nil && operation.Extensions["x-ticket"] == nil {
					t.Errorf("openapi: %s planned operation %s needs x-planned-changes or x-ticket", service, op)
				}
			}
		})
	}
}
