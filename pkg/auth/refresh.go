package auth

import (
	"context"
	"errors"
)

var ErrInvalidRefreshToken = errors.New("invalid or already-used refresh token")

type RefreshTokenStore interface {
	Rotate(ctx context.Context, presentedToken string) (newToken string, userID string, err error)
}
