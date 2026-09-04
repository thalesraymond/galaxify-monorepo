# ADR-0008: Handler-owned interfaces and table-driven HTTP handler tests

- **Status:** Accepted
- **Date:** 2026-09-04
- **Source:** Handler testability refactor in `apps/user-service/internal/handler`

## Context

HTTP handlers in this repo are the boundary between the transport layer and the
service domain. They are also the easiest place to accidentally couple tests to
a live database, because the natural first implementation passes a
`database.Querier` directly into the handler and writes tests against it.

The demo project showed a cleaner shape: handlers depend on a narrow,
handler-owned store interface; tests wire in tiny mocks; and table-driven tests
exercise both direct handler calls and the registered mux routes. We want every
handler in this repo to follow that shape so that:

1. Unit tests run without a database.
2. Mocks stay small when `database.Querier` grows.
3. Tests cover routing, path parameters, and middleware — not just the bare
   handler function.

## Decision

### 1. Handlers depend on a narrow, handler-owned interface

Each handler package declares the smallest interface it needs from its store,
rather than accepting the full generated `database.Querier`.

```go
// apps/user-service/internal/handler/auth.go
type authStore interface {
	InsertUser(ctx context.Context, arg database.InsertUserParams) (database.User, error)
	InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
}

type AuthHandler struct {
	store     authStore
	publisher EventPublisher
	logger    *slog.Logger
}
```

The concrete `*database.Queries` still satisfies the interface, so production
wiring in `main.go` does not change. Tests implement only those methods.

### 2. Handlers expose a route-registration method

Every handler type exposes a method that registers its routes on an
`http.ServeMux`:

```go
func (h *AuthHandler) RegisterAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /users", h.Signup)
	mux.HandleFunc("/.well-known/jwks.json", h.GetJWKS)
}
```

This keeps route wiring out of `main.go` details and lets tests exercise the
real route table (path parameters, HTTP method patterns, etc.).

### 3. Tests use shared package-local helpers

Each handler test file provides helpers modeled on the demo project:

```go
func newTestAuthHandler(t *testing.T, store authStore, publisher EventPublisher) *AuthHandler
func newTestAuthRouter(t *testing.T, store authStore, publisher EventPublisher) http.Handler
func newTestRequest(t *testing.T, method, target, body string) *http.Request
func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int)
func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, v any)
func wantErrorCode(t *testing.T, rec *httptest.ResponseRecorder, want string)
func wantFieldError(t *testing.T, rec *httptest.ResponseRecorder, field, wantMessage string)
```

Helpers live in the handler package's `_test.go` files. When the same helpers
are duplicated across two or more services, move them to `pkg/sharedhttp/test`
(or similar) rather than copying them again.

### 4. Tests are table-driven and assert on store calls

Each handler method gets one table-driven test with cases for the happy path,
validation failures, not-found errors, store errors, and authorization failures
where applicable.

Tests should assert not only the HTTP response but also that the store received
the expected parameters. This catches silent data transformations between the
HTTP request and the database call.

```go
if mock.createChirpParams.UserID != testUserID {
    t.Errorf("store received userID = %v, want %v", mock.createChirpParams.UserID, testUserID)
}
```

### 5. Route-level tests go through the mux

Tests that exercise path parameters or middleware must use the registered mux,
not the bare handler method:

```go
router := newTestAuthRouter(t, store, publisher)
rec := httptest.NewRecorder()
req := newTestRequest(t, http.MethodGet, "/.well-known/jwks.json", "")
router.ServeHTTP(rec, req)
```

Tests that only need body parsing and response writing may call the handler
method directly.

## Alternatives Considered

### Pass `database.Querier` directly and mock the full interface

- **Pros:** no extra interface to maintain; the mock type matches the real
  dependency exactly.
- **Cons:** every test mock must implement every method on `Querier`, most with
  `panic("unimplemented")`. Adding a new query method breaks every handler test
  even when that method is unrelated to the handler under test.
- **Rejected:** the interface maintenance cost is tiny; the mock noise and
  cascading test breakage are not.

### Use a mocking library (e.g., testify/mock or mockery)

- **Pros:** less hand-written mock code; generated mocks can be regenerated when
  interfaces change.
- **Cons:** adds a dependency and generated-code churn for interfaces that are
  intentionally small. Hand-written struct mocks with function fields are
  explicit and trivial for narrow interfaces.
- **Rejected:** keep the standard-library-first approach for handler tests
  unless a service needs many more store methods than a simple struct mock can
  comfortably hold.

### Test only the bare handler methods, never the route table

- **Pros:** slightly simpler tests; no need to build a mux in each test.
- **Cons:** misses path-parameter parsing (`r.PathValue`), method matching, and
  any middleware applied by `RegisterXRoutes`. Those are real failure modes.
- **Rejected:** route-level tests are the default for endpoints that have path
  parameters or middleware; direct handler calls are allowed for simple cases.

## Consequences

- Handler packages declare their own store interfaces, so mocks are small and
  stable.
- `database.Querier` can grow without breaking handler tests, as long as the
  handler's narrower interface is still satisfied by `*database.Queries`.
- Every handler exposes a registration method, keeping `main.go` wiring thin and
  consistent.
- Tests follow a recognizable shape across services, making it easier to add new
  handlers and review test PRs.
- Helpers duplicated across services are a signal to extract them into `pkg/`.
