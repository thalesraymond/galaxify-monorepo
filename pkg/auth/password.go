package auth

import (
	"github.com/alexedwards/argon2id"
)

func HashPassword(plaintext string) (hash string, err error) {
	return argon2id.CreateHash(plaintext, argon2id.DefaultParams)
}

func ComparePasswordAndHash(plaintext, hash string) (match bool, err error) {
	return argon2id.ComparePasswordAndHash(plaintext, hash)
}
