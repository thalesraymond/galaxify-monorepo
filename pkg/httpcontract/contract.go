// Package httpcontract provides kin-openapi helpers that let each Galaxify
// service test its real net/http mux against the OpenAPI 3.1 documents under
// docs/openapi.
//
// It is test-only infrastructure: services use it from *_test.go files to prove
// that the routes they register and the bytes they put on the wire agree with
// the contract documents. It never runs in production.
package httpcontract

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"github.com/google/uuid"
)

// ImplementationStatusExtension marks an operation as "implemented" (the
// current Go behavior) or "planned" (a locked Phase 1 delta that is not on the
// wire yet). Operations without the extension default to "implemented".
const ImplementationStatusExtension = "x-implementation-status"

// StatusImplemented is the value that marks an operation or field as the
// current, exercised wire behavior. It is also the default when the extension
// is absent.
const StatusImplemented = "implemented"

// StatusPlanned is the value that marks an operation or field as planned.
const StatusPlanned = "planned"

// RepoRoot returns the absolute path of the repository root. It locates the
// root by walking up until it finds the committed go.work workspace file,
// starting from this source file (and falling back to the working directory
// when the binary was built with -trimpath) so tests can run from any module
// directory.
func RepoRoot() string {
	if _, file, _, ok := runtime.Caller(0); ok {
		if root, found := findRepoRoot(filepath.Dir(file)); found {
			return root
		}
	}
	if wd, err := os.Getwd(); err == nil {
		if root, found := findRepoRoot(wd); found {
			return root
		}
	}
	panic("httpcontract: unable to locate the repository root (no go.work found)")
}

func findRepoRoot(dir string) (string, bool) {
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// SpecPath returns the absolute path of a service's OpenAPI document. Pass the
// service short name without the "-service" suffix, e.g. SpecPath("user") for
// docs/openapi/user-service.yaml.
func SpecPath(service string) string {
	return filepath.Join(RepoRoot(), "docs", "openapi", service+"-service.yaml")
}

// LoadSpec loads and fully validates the named service's OpenAPI document,
// failing the test on any load or validation error.
func LoadSpec(t *testing.T, service string) *openapi3.T {
	t.Helper()
	path := SpecPath(service)
	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = true
	loader.Context = context.Background()

	doc, err := loader.LoadFromFile(path)
	if err != nil {
		t.Fatalf("openapi: load spec for %s from %s: %v", service, path, err)
	}
	if err := doc.Validate(loader.Context); err != nil {
		t.Fatalf("openapi: validate spec for %s (%s): %v", service, path, err)
	}
	return doc
}

// Operation identifies one HTTP operation by method and OpenAPI path template.
type Operation struct {
	Method string
	Path   string
}

// String renders an operation as "METHOD /path".
func (o Operation) String() string {
	return strings.ToUpper(o.Method) + " " + o.Path
}

// ImplementedOperations returns every operation in doc whose
// x-implementation-status is not "planned", sorted by path then method.
func ImplementedOperations(t *testing.T, doc *openapi3.T) []Operation {
	t.Helper()
	return operationsWithStatus(t, doc, false)
}

// PlannedOperations returns every operation in doc marked
// x-implementation-status: planned, sorted by path then method.
func PlannedOperations(t *testing.T, doc *openapi3.T) []Operation {
	t.Helper()
	return operationsWithStatus(t, doc, true)
}

func operationsWithStatus(t *testing.T, doc *openapi3.T, planned bool) []Operation {
	t.Helper()
	var ops []Operation
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			if (implementationStatus(op) == StatusPlanned) != planned {
				continue
			}
			ops = append(ops, Operation{Method: strings.ToUpper(method), Path: path})
		}
	}
	sortOperations(ops)
	return ops
}

func implementationStatus(op *openapi3.Operation) string {
	if op == nil || op.Extensions == nil {
		return StatusImplemented
	}
	raw, ok := op.Extensions[ImplementationStatusExtension]
	if !ok {
		return StatusImplemented
	}
	status, ok := raw.(string)
	if !ok || status == "" {
		return StatusImplemented
	}
	return strings.ToLower(status)
}

func sortOperations(ops []Operation) {
	sort.Slice(ops, func(i, j int) bool {
		if ops[i].Path != ops[j].Path {
			return ops[i].Path < ops[j].Path
		}
		return ops[i].Method < ops[j].Method
	})
}

// AssertRouteCoverage proves that the operations a caller declares as
// registered and the operations the spec marks as implemented are exactly the
// same set:
//
//   - every implemented spec operation must be in the registered set;
//   - every registered operation must appear in the spec as implemented.
//
// The registered set is supplied by the caller because http.ServeMux does not
// expose its patterns; callers build it from the service's route registration.
// Pair this with AssertRoutePatterns, which proves every declared operation
// actually matches its spec path on the real mux. Neither call can detect a
// route that a service registers but forgets to declare.
//
// Planned operations may be absent from the mux but must be explicitly marked
// planned.
func AssertRouteCoverage(t *testing.T, doc *openapi3.T, registered []Operation) {
	t.Helper()
	implemented := ImplementedOperations(t, doc)

	implSet := make(map[string]Operation, len(implemented))
	for _, op := range implemented {
		implSet[op.String()] = op
	}
	regSet := make(map[string]Operation, len(registered))
	for _, op := range registered {
		regSet[op.String()] = op
	}

	var missingFromMux, missingFromSpec []string
	for key, op := range implSet {
		if _, ok := regSet[key]; !ok {
			missingFromMux = append(missingFromMux, op.String())
		}
	}
	for key, op := range regSet {
		if _, ok := implSet[key]; !ok {
			missingFromSpec = append(missingFromSpec, op.String())
		}
	}
	sort.Strings(missingFromMux)
	sort.Strings(missingFromSpec)

	if len(missingFromMux) > 0 {
		t.Errorf("openapi: implemented spec operations missing from the registered mux: %s", strings.Join(missingFromMux, ", "))
	}
	if len(missingFromSpec) > 0 {
		t.Errorf("openapi: registered mux operations missing from the spec (or not marked implemented): %s", strings.Join(missingFromSpec, ", "))
	}
}

var pathParamPattern = regexp.MustCompile(`\{[^}]+\}`)

// sampleUUID is used to materialize path templates when probing a mux.
const sampleUUID = "00000000-0000-0000-0000-000000000001"

// SamplePath replaces every {param} template in a path with a fixed UUID so a
// concrete request can be built for mux.Handler probing.
func SamplePath(path string) string {
	return pathParamPattern.ReplaceAllString(path, sampleUUID)
}

// AssertRoutePatterns proves that each operation is registered on mux under
// exactly the spec's templated pattern, using the Go 1.22+ (*ServeMux).Handler
// pattern return value. It fails with the operation identified when the mux
// answers "" (no route or wrong method) or a different pattern.
//
// A method-less registration (pattern equal to the bare path, as used by
// mux.HandleFunc("/.well-known/jwks.json", ...)) is accepted because Go's mux
// serves every method for it.
func AssertRoutePatterns(t *testing.T, mux *http.ServeMux, ops []Operation) {
	t.Helper()
	for _, op := range ops {
		req := httptest.NewRequest(op.Method, SamplePath(op.Path), nil)
		_, pattern := mux.Handler(req)
		want := op.Method + " " + op.Path
		if pattern != want && pattern != op.Path {
			t.Errorf("openapi: operation %s: mux.Handler matched pattern %q, want %q", op, pattern, want)
		}
	}
}

// ValidateExchange validates a conforming request and its response against the
// operation selected by the request's method and path. The request Body must
// not have been read yet.
//
// A no-op AuthenticationFunc is used so JWT signatures are not re-verified;
// security requirements are documented and exercised by the service tests.
func ValidateExchange(t *testing.T, doc *openapi3.T, req *http.Request, res *http.Response) {
	t.Helper()
	route, pathParams := findRoute(t, doc, req)
	input := newRequestInput(req, route, pathParams)
	if err := openapi3filter.ValidateRequest(context.Background(), input); err != nil {
		t.Errorf("openapi: operation %s: request violates contract: %v", operationLabel(route, req), err)
	}
	validateResponse(t, input, res)
}

// ValidateExchangeResponse validates only the response of an exchange whose
// request intentionally violates the spec (for example a malformed JSON body or
// an out-of-enum value that the service rejects with 4xx). Response validation
// still identifies the operation from the request route.
func ValidateExchangeResponse(t *testing.T, doc *openapi3.T, req *http.Request, res *http.Response) {
	t.Helper()
	route, pathParams := findRoute(t, doc, req)
	input := newRequestInput(req, route, pathParams)
	validateResponse(t, input, res)
}

// ExchangeOptions controls how RunExchange validates one request/response case.
type ExchangeOptions struct {
	// ValidateRequest also validates the request bytes against the operation.
	// Set false for a request that intentionally violates the contract
	// (malformed JSON, an out-of-enum value, a missing auth header) while the
	// response bytes should still be checked.
	ValidateRequest bool
	// WantStatus is the expected HTTP status code.
	WantStatus int
}

// RunExchange builds a request with newRequest, serves it through handler, and
// validates the response (and the request unless ValidateRequest is false)
// against the operation selected by the request in doc. It also asserts the
// response carries a UUID X-Request-Id and that the status is WantStatus.
//
// newRequest must return a fresh request on every call: request bodies are
// consumed both while serving and while validating.
func RunExchange(t *testing.T, doc *openapi3.T, handler http.Handler, newRequest func() *http.Request, opts ExchangeOptions) {
	t.Helper()

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newRequest())
	res := rec.Result()

	if opts.ValidateRequest {
		ValidateExchange(t, doc, newRequest(), res)
	} else {
		ValidateExchangeResponse(t, doc, newRequest(), res)
	}
	AssertRequestIDHeader(t, res)
	if res.StatusCode != opts.WantStatus {
		t.Errorf("openapi: status = %d, want %d", res.StatusCode, opts.WantStatus)
	}
}

func newRequestInput(req *http.Request, route *routers.Route, pathParams map[string]string) *openapi3filter.RequestValidationInput {
	return &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
		Options: &openapi3filter.Options{
			AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		},
	}
}

func findRoute(t *testing.T, doc *openapi3.T, req *http.Request) (*routers.Route, map[string]string) {
	t.Helper()
	router, err := gorillamux.NewRouter(doc)
	if err != nil {
		t.Fatalf("openapi: build router: %v", err)
	}
	route, pathParams, err := router.FindRoute(req)
	if err != nil {
		t.Fatalf("openapi: no spec operation for %s %s: %v", req.Method, req.URL.Path, err)
	}
	return route, pathParams
}

func validateResponse(t *testing.T, input *openapi3filter.RequestValidationInput, res *http.Response) {
	t.Helper()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("openapi: operation %s: read response body: %v", operationLabel(input.Route, input.Request), err)
	}
	_ = res.Body.Close()

	respInput := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: input,
		Status:                 res.StatusCode,
		Header:                 res.Header,
		Options: &openapi3filter.Options{
			// ExcludeResponseBody defaults to false, so the body is validated.
			IncludeResponseStatus: true,
		},
	}
	respInput.SetBodyBytes(body)

	if err := openapi3filter.ValidateResponse(context.Background(), respInput); err != nil {
		t.Errorf("openapi: operation %s: response %d violates contract: %v (body: %s)",
			operationLabel(input.Route, input.Request), res.StatusCode, err, string(body))
	}
}

func operationLabel(route *routers.Route, req *http.Request) string {
	if route != nil && route.Operation != nil && route.Operation.OperationID != "" {
		return fmt.Sprintf("%s (%s %s)", route.Operation.OperationID, req.Method, route.Path)
	}
	if route != nil {
		return fmt.Sprintf("%s %s", req.Method, route.Path)
	}
	return fmt.Sprintf("%s %s", req.Method, req.URL.Path)
}

// AssertRequestIDHeader proves the response carries an X-Request-Id header
// whose value is a UUID.
func AssertRequestIDHeader(t *testing.T, res *http.Response) {
	t.Helper()
	got := res.Header.Get("X-Request-Id")
	if got == "" {
		t.Errorf("openapi: response is missing the X-Request-Id header")
		return
	}
	if _, err := uuid.Parse(got); err != nil {
		t.Errorf("openapi: X-Request-Id = %q, want a UUID: %v", got, err)
	}
}
