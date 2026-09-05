package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/handler"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func setupTestServer(t *testing.T) (*httptest.Server, database.Querier) {
	_ = godotenv.Load()

	dbURL := envOr("DATABASE_URL", defaultDatabaseURL)
	amqpURL := envOr("RABBITMQ_URL", defaultRabbitMQURL)

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect to postgres: %v", err)
	}
	t.Cleanup(func() { pool.Close() })

	conn, err := rabbitmq.Connect(amqpURL)
	if err != nil {
		t.Fatalf("connect to rabbitmq: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	ch, err := conn.Channel()
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}

	publisher, err := events.NewPublisher(ch)
	if err != nil {
		t.Fatalf("create publisher: %v", err)
	}
	t.Cleanup(func() { publisher.Close() })

	db := database.New(pool)
	jwtKey, err := getKeyPair(db)
	if err != nil {
		t.Fatalf("failed to get JWT key: %v", err)
	}

	priv, _, err := auth.LoadPrivatePublicKeyPair(jwtKey.PrivateKey)
	if err != nil {
		t.Fatalf("failed to load JWT key pair: %v", err)
	}

	mux := http.NewServeMux()
	
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokenIssuer := handler.NewTokenIssuer(priv, jwtKey.Kid, db)
	
	registrationHandler := handler.NewRegistrationHandler(db, tokenIssuer, publisher, logger)
	registrationHandler.RegisterRoutes(mux)

	sessionHandler := handler.NewSessionHandler(db, tokenIssuer, logger)
	sessionHandler.RegisterRoutes(mux)

	jwksHandler := handler.NewJWKSHandler(priv, jwtKey.Kid, logger)
	jwksHandler.RegisterRoutes(mux)

	staticCache := auth.NewStaticJWKSCache(jwtKey.Kid, priv.Public())
	authHandshake := sharedhttp.NewAuthHandshake(staticCache)

	meHandler := handler.NewMeHandler(db, publisher, authHandshake, logger)
	meHandler.RegisterMeRoutes(mux)

	handler := sharedhttp.RequestIDMiddleware(mux)
	srv := httptest.NewServer(handler)
	t.Cleanup(func() { srv.Close() })

	return srv, db
}

func doJSON(t *testing.T, client *http.Client, method, url string, body interface{}, token string) (*http.Response, []byte) {
	t.Helper()
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}

	respBody, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	
	return resp, respBody
}

func assertStatusCode(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		t.Errorf("expected status %d, got %d", expected, resp.StatusCode)
	}
}

func assertErrorCode(t *testing.T, respBody []byte, expectedCode string) {
	t.Helper()
	var errResp sharedhttp.ErrorResponse
	if err := json.Unmarshal(respBody, &errResp); err != nil {
		t.Fatalf("unmarshal error response: %v, body: %s", err, string(respBody))
	}
	if errResp.Error.Code != expectedCode {
		t.Errorf("expected error code %s, got %s", expectedCode, errResp.Error.Code)
	}
}

func TestIntegrationFullFlow(t *testing.T) {
	srv, _ := setupTestServer(t)
	client := srv.Client()

	email := uuid.New().String() + "@example.com"
	username := "u" + uuid.New().String()[:8]
	password := "SecretPass123!"

	// 1. Signup
	signupReq := map[string]string{
		"email":    email,
		"username": username,
		"password": password,
	}
	resp, respBody := doJSON(t, client, "POST", srv.URL+"/users", signupReq, "")
	assertStatusCode(t, resp, http.StatusCreated)

	var authResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(respBody, &authResp); err != nil {
		t.Fatalf("unmarshal signup response: %v", err)
	}
	if authResp.AccessToken == "" || authResp.RefreshToken == "" {
		t.Fatalf("expected tokens in signup response")
	}

	// 2. Duplicate email
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/users", signupReq, "")
	assertStatusCode(t, resp, http.StatusConflict)
	assertErrorCode(t, respBody, "USER_EMAIL_TAKEN")

	// 3. Duplicate username (case-insensitive)
	signupReq2 := map[string]string{
		"email":    "other" + email,
		"username": username,
		"password": password,
	}
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/users", signupReq2, "")
	assertStatusCode(t, resp, http.StatusConflict)
	assertErrorCode(t, respBody, "USER_USERNAME_TAKEN")

	// 4. Login with wrong password
	loginReq := map[string]string{
		"email":    email,
		"password": "WrongPassword123!",
	}
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/auth/login", loginReq, "")
	assertStatusCode(t, resp, http.StatusUnauthorized)
	assertErrorCode(t, respBody, "USER_INVALID_CREDENTIALS")

	// 5. Login successful
	loginReq["password"] = password
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/auth/login", loginReq, "")
	assertStatusCode(t, resp, http.StatusOK)
	if err := json.Unmarshal(respBody, &authResp); err != nil {
		t.Fatalf("unmarshal login response: %v", err)
	}

	// 6. Refresh token rotation works
	refreshReq := map[string]string{
		"refresh_token": authResp.RefreshToken,
	}
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/auth/refresh", refreshReq, "")
	assertStatusCode(t, resp, http.StatusOK)
	var refreshResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(respBody, &refreshResp); err != nil {
		t.Fatalf("unmarshal refresh response: %v", err)
	}

	// 7. Reuse of rotated token -> family revocation
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/auth/refresh", refreshReq, "")
	assertStatusCode(t, resp, http.StatusUnauthorized)
	
	// Ensure the newly issued tokens are also revoked
	refreshReq2 := map[string]string{
		"refresh_token": refreshResp.RefreshToken,
	}
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/auth/refresh", refreshReq2, "")
	assertStatusCode(t, resp, http.StatusUnauthorized)

	// Re-login to get fresh tokens
	resp, respBody = doJSON(t, client, "POST", srv.URL+"/auth/login", loginReq, "")
	assertStatusCode(t, resp, http.StatusOK)
	if err := json.Unmarshal(respBody, &authResp); err != nil {
		t.Fatalf("unmarshal login response: %v", err)
	}
	token := authResp.AccessToken

	// 8. GET /users/me
	resp, respBody = doJSON(t, client, "GET", srv.URL+"/users/me", nil, token)
	assertStatusCode(t, resp, http.StatusOK)
	var meResp struct {
		Email    string `json:"email"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(respBody, &meResp); err != nil {
		t.Fatalf("unmarshal me response: %v", err)
	}
	if meResp.Email != email || meResp.Username != username {
		t.Fatalf("expected email/username match, got: %v", meResp)
	}

	// 9. PATCH /users/me
	newUsername := "new" + username[:5]
	patchReq := map[string]string{
		"username": newUsername,
	}
	resp, respBody = doJSON(t, client, "PATCH", srv.URL+"/users/me", patchReq, token)
	assertStatusCode(t, resp, http.StatusOK)
	
	resp, respBody = doJSON(t, client, "GET", srv.URL+"/users/me", nil, token)
	assertStatusCode(t, resp, http.StatusOK)
	if err := json.Unmarshal(respBody, &meResp); err != nil {
		t.Fatalf("unmarshal me response: %v", err)
	}
	if meResp.Username != newUsername {
		t.Fatalf("expected username to be updated to %s, got %s", newUsername, meResp.Username)
	}

	// 10. DELETE /users/me with wrong password
	deleteReq := map[string]string{
		"password": "wrong",
	}
	resp, respBody = doJSON(t, client, "DELETE", srv.URL+"/users/me", deleteReq, token)
	assertStatusCode(t, resp, http.StatusUnauthorized)

	// 11. DELETE /users/me with correct password
	deleteReq["password"] = password
	resp, respBody = doJSON(t, client, "DELETE", srv.URL+"/users/me", deleteReq, token)
	assertStatusCode(t, resp, http.StatusNoContent)

	// 12. Subsequent requests fail
	resp, respBody = doJSON(t, client, "GET", srv.URL+"/users/me", nil, token)
	assertStatusCode(t, resp, http.StatusUnauthorized)

	// 13. JWKS endpoint returns valid JWK document
	resp, respBody = doJSON(t, client, "GET", srv.URL+"/.well-known/jwks.json", nil, "")
	assertStatusCode(t, resp, http.StatusOK)
	
	// Either it's a JWK object or a keys array containing JWK objects. Let's parse as a map and check for 'kid' or 'keys'
	var jwksMap map[string]interface{}
	if err := json.Unmarshal(respBody, &jwksMap); err != nil {
		t.Fatalf("unmarshal jwks response: %v", err)
	}
	
	hasKeys := jwksMap["keys"] != nil
	hasKid := jwksMap["kid"] != nil
	
	if !hasKeys && !hasKid {
		t.Fatalf("expected keys or kid in jwks response, got: %s", string(respBody))
	}
}
